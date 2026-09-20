// Real backend: plain externally owned accounts on Base Sepolia, held through
// AgentKit's ViemWalletProvider. One private key per wallet, one viem wallet
// client per key, one provider per wallet.
//
// AgentKit still owns the wallet: this module builds the viem client and hands
// it to ViemWalletProvider, then talks only to the provider. Nothing here
// calls viem's transport directly.
//
// Keys enter through the constructor and are never stored on the returned
// wallet, never logged, and never returned. The only thing that leaves this
// module is an address and a transaction hash.

import { ViemWalletProvider } from "@coinbase/agentkit";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { log } from "../log";
import { guardAgentKitAnalytics } from "./analyticsGuard";
import { ADDRESS, WALLET_ID, type Call, type Chain, type TxReceipt, type Wallet } from "./types";

type Hex = `0x${string}`;

/** 0.0002 ETH, comfortably more than a handful of Base Sepolia transfers. */
export const DEFAULT_GAS_RESERVE_WEI = 200_000_000_000_000n;

/** The slice of ViemWalletProvider this module uses, so tests can stub it. */
export interface WalletProviderLike {
  getAddress(): string;
  getBalance(): Promise<bigint>;
  sendTransaction(transaction: { to: Hex; value: bigint; data?: Hex }): Promise<Hex>;
  waitForTransactionReceipt(hash: Hex): Promise<{ status: string; transactionHash: Hex }>;
}

export interface ViemChainConfig {
  /** Private key per wallet id. Never persisted, never logged. */
  keys: Record<string, Hex>;
  /** Defaults to the chain's public endpoint, which is rate limited. */
  rpcUrl?: string;
}

export type ProviderFactory = (walletId: string, privateKey: Hex, rpcUrl?: string) => WalletProviderLike;

/** The real factory: a viem wallet client wrapped in AgentKit's provider. */
const defaultFactory: ProviderFactory = (_walletId, privateKey, rpcUrl) => {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });
  return new ViemWalletProvider(walletClient, rpcUrl ? { rpcUrl } : undefined) as unknown as WalletProviderLike;
};

export class ViemChain implements Chain {
  readonly kind = "viem" as const;
  readonly network = "base-sepolia";
  /** A real chain, so transaction hashes are worth linking. */
  readonly settles = true;
  /**
   * Held back for gas. A plain transfer on Base Sepolia is around 21,000 gas
   * and fees are in the low gwei, so this is generous by orders of magnitude
   * and still far below a sensible funding amount. An agent that cannot cover
   * its stake plus this is excluded rather than left to revert mid round.
   */
  readonly gasReserveWei = DEFAULT_GAS_RESERVE_WEI;
  private readonly providers = new Map<string, WalletProviderLike>();

  constructor(
    private readonly config: ViemChainConfig,
    private readonly factory: ProviderFactory = defaultFactory,
  ) {
    // AgentKit's analytics call on provider construction is an unawaited,
    // uncaught promise. Without this, an unreachable analytics host takes the
    // process down. See analyticsGuard.ts.
    guardAgentKitAnalytics();
  }

  async open(id: string, address?: string): Promise<Wallet> {
    if (!WALLET_ID.test(id)) throw new RangeError(`wallet id must match ${WALLET_ID}`);
    if (address !== undefined && !ADDRESS.test(address)) throw new RangeError("address must be 20 bytes of hex");

    const provider = this.providerFor(id);
    const walletAddress = provider.getAddress();

    // A persisted address that disagrees with the key means the keys changed
    // under a registry that still points at the old wallets. Refuse rather
    // than quietly settle a round against a wallet nobody funded.
    if (address !== undefined && address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error(`wallet ${id}: stored address ${address} does not match the address its key derives`);
    }

    log.info("viem wallet ready", { id, address: walletAddress, network: this.network });

    return {
      id,
      address: walletAddress,
      getBalance: () => provider.getBalance(),
      send: async (calls: readonly Call[], idempotencyKey: string): Promise<TxReceipt> => {
        for (const call of calls) {
          if (!ADDRESS.test(call.to)) throw new RangeError(`transfer destination must be an address, got ${call.to}`);
        }
        // An EOA has no batching, so each call is its own transaction sent in
        // order. The ledger's idempotency key still covers the whole transfer;
        // it is simply no longer echoed to the chain.
        let last: TxReceipt | undefined;
        for (const call of calls) {
          const hash = await provider.sendTransaction({ to: call.to as Hex, value: call.value, data: call.data });
          const receipt = await provider.waitForTransactionReceipt(hash);
          if (receipt.status !== "success") {
            throw new Error(`transaction ${hash} ${receipt.status} for ${idempotencyKey}`);
          }
          last = { txHash: receipt.transactionHash, status: "complete" };
        }
        if (!last) throw new RangeError("send needs at least one call");
        return last;
      },
    };
  }

  private providerFor(id: string): WalletProviderLike {
    const existing = this.providers.get(id);
    if (existing) return existing;
    const key = this.config.keys[id];
    if (!key) {
      throw new Error(`wallet ${id} has no private key: set ${`SERVPIT_KEY_${id.toUpperCase()}`} in .env.local`);
    }
    const provider = this.factory(id, key, this.config.rpcUrl);
    this.providers.set(id, provider);
    return provider;
  }
}
