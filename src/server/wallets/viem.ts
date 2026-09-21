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
import { createPublicClient, createWalletClient, fallback, http, parseAbi, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { DEFAULT_RPC_URLS } from "@/config/rpc";
import { log } from "../log";
import { guardAgentKitAnalytics } from "./analyticsGuard";
import { ADDRESS, WALLET_ID, type Call, type Chain, type TxReceipt, type Wallet } from "./types";

type Hex = `0x${string}`;

/**
 * 0.00002 ETH. Kept as the fallback for a config that does not name one; the
 * value and the reasoning live in src/server/env.ts, which reads
 * SERVPIT_GAS_RESERVE_ETH.
 */
export const DEFAULT_GAS_RESERVE_WEI = 20_000_000_000_000n;

/**
 * The receipt fields this module reads. Base is an OP stack chain, so viem's
 * formatter puts the L1 data fee on the receipt alongside the L2 gas: both
 * come out of the sender and both have to be counted.
 */
export interface ChainReceipt {
  status: string;
  transactionHash: Hex;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  l1Fee?: bigint | null;
}

/**
 * Fee the sender actually paid, from the receipt. Never an estimate: the L1
 * component varies per transaction with its calldata and the L1 base fee, so
 * two transfers in the same round do not cost the same. Measured on the first
 * settled round: 6252136428 wei of L1 fee on three entries and 5698658288 on
 * the fourth.
 */
export function feeFromReceipt(receipt: ChainReceipt): bigint {
  const l2 = (receipt.gasUsed ?? 0n) * (receipt.effectiveGasPrice ?? 0n);
  return l2 + (receipt.l1Fee ?? 0n);
}

/** The slice of ViemWalletProvider this module uses, so tests can stub it. */
export interface WalletProviderLike {
  getAddress(): string;
  getBalance(): Promise<bigint>;
  sendTransaction(transaction: { to: Hex; value: bigint; data?: Hex }): Promise<Hex>;
  waitForTransactionReceipt(hash: Hex): Promise<ChainReceipt>;
}

/**
 * How long one endpoint gets before the next one is tried.
 *
 * viem's default is 10 s, and with its default three retries that is four
 * attempts against one unreachable host: 44 s measured, the whole decision
 * phase spent waiting on a single endpoint that was never going to answer.
 * Short enough here that walking all three costs less than one old attempt.
 */
export const RPC_TIMEOUT_MS = 5_000;

/** Times the whole chain of endpoints is walked before the read gives up. */
export const RPC_ATTEMPTS = 2;

/** Base delay between attempts. viem doubles it per attempt. */
export const RPC_RETRY_DELAY_MS = 200;

/**
 * Multicall3, at the same address on every chain that has it, including Base
 * Sepolia. Its getEthBalance turns one balance read per wallet into a single
 * eth_call for all of them.
 *
 * Chosen over JSON-RPC batching by measurement across all three fallback
 * endpoints: drpc answers a batch of more than three with "Batch of more than
 * 3 requests are not allowed on free plan" (code 31), and a round reads seven
 * wallets. Multicall worked on all three and was faster on every one of them.
 */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const GET_ETH_BALANCE = parseAbi(["function getEthBalance(address addr) view returns (uint256)"]);

export interface ViemChainConfig {
  /** Private key per wallet id. Never persisted, never logged. */
  keys: Record<string, Hex>;
  /**
   * Endpoints to try in order. Defaults to the chain's public endpoint, which
   * is rate limited.
   */
  rpcUrls?: string[];
  /** Held back for gas. Defaults to DEFAULT_GAS_RESERVE_WEI. */
  gasReserveWei?: bigint;
}

export type ProviderFactory = (walletId: string, privateKey: Hex, rpcUrl?: string) => WalletProviderLike;

/** The slice of a viem public client this module uses, so tests can stub it. */
export interface BalanceReader {
  readBalances(addresses: readonly string[]): Promise<bigint[]>;
}

/**
 * Reads balances through every endpoint in turn.
 *
 * This exists because AgentKit will not. ViemWalletProvider builds its own
 * public client in its constructor, `createPublicClient({ transport: rpcUrl ?
 * http(rpcUrl) : http() })`, and getBalance goes through that. Nothing
 * configured on the wallet client's transport reaches a balance read, so a
 * fallback handed to AgentKit would be ignored. Reads come through here and
 * AgentKit keeps owning signing and sending.
 */
export function createBalanceReader(rpcUrls: readonly string[] = DEFAULT_RPC_URLS): BalanceReader {
  const urls = rpcUrls.length > 0 ? rpcUrls : DEFAULT_RPC_URLS;
  const client = createPublicClient({
    chain: baseSepolia,
    // fallback walks the list on failure and, with a retry count of its own,
    // walks it again with an exponential backoff between passes.
    transport: fallback(
      urls.map((url) => http(url, { timeout: RPC_TIMEOUT_MS })),
      { retryCount: RPC_ATTEMPTS - 1, retryDelay: RPC_RETRY_DELAY_MS },
    ),
  }) as PublicClient;

  return {
    async readBalances(addresses) {
      if (addresses.length === 0) return [];
      return client.multicall({
        contracts: addresses.map((address) => ({ address: MULTICALL3, abi: GET_ETH_BALANCE, functionName: "getEthBalance" as const, args: [address as Hex] })),
        allowFailure: false,
      });
    },
  };
}

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
   * Held back for gas, and the floor an agent must clear on top of its stake
   * to be let into a round. An agent that cannot cover both is excluded
   * rather than left to revert mid round.
   *
   * It has to stay well below the per wallet funding target or it excludes
   * every agent it is meant to protect. That is what the previous 0.0002 ETH
   * did once wallets were funded to 0.0001.
   */
  readonly gasReserveWei: bigint;
  private readonly providers = new Map<string, WalletProviderLike>();
  private readonly reader: BalanceReader;
  private readonly rpcUrls: readonly string[];

  constructor(
    private readonly config: ViemChainConfig,
    private readonly factory: ProviderFactory = defaultFactory,
    reader?: BalanceReader,
  ) {
    this.gasReserveWei = config.gasReserveWei ?? DEFAULT_GAS_RESERVE_WEI;
    this.rpcUrls = config.rpcUrls && config.rpcUrls.length > 0 ? config.rpcUrls : DEFAULT_RPC_URLS;
    this.reader = reader ?? createBalanceReader(this.rpcUrls);
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
      // Through the fallback reader, not through the provider. AgentKit's own
      // public client has one endpoint, no fallback and viem's ten second
      // default, which is exactly what took the decision phase down.
      getBalance: async () => (await this.getBalances([walletAddress]))[walletAddress] ?? 0n,
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
          last = { txHash: receipt.transactionHash, status: "complete", feeWei: feeFromReceipt(receipt) };
        }
        if (!last) throw new RangeError("send needs at least one call");
        return last;
      },
    };
  }

  /**
   * Every balance in one request.
   *
   * A round reads seven wallets and used to make seven round trips, one after
   * another. They are one eth_call now, which is one thing that can time out
   * instead of seven.
   */
  async getBalances(addresses: readonly string[]): Promise<Record<string, bigint>> {
    for (const address of addresses) {
      if (!ADDRESS.test(address)) throw new RangeError(`balance lookup needs an address, got ${address}`);
    }
    const unique = [...new Set(addresses)];
    const balances = await this.reader.readBalances(unique);
    const out: Record<string, bigint> = {};
    unique.forEach((address, i) => {
      out[address] = balances[i];
    });
    return out;
  }

  private providerFor(id: string): WalletProviderLike {
    const existing = this.providers.get(id);
    if (existing) return existing;
    const key = this.config.keys[id];
    if (!key) {
      throw new Error(`wallet ${id} has no private key: set ${`SERVPIT_KEY_${id.toUpperCase()}`} in .env.local`);
    }
    const provider = this.factory(id, key, this.rpcUrls[0]);
    this.providers.set(id, provider);
    return provider;
  }
}
