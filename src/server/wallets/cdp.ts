// Real backend: Coinbase Developer Platform smart wallets through AgentKit's
// CdpSmartWalletProvider on base-sepolia. Each wallet id maps to a named
// CDP server account (the owner) and one smart account. Transfers go out as
// user operations with the CDP paymaster sponsoring gas, one idempotency
// key per transfer. Nothing here ever returns or logs a key.

import { CdpSmartWalletProvider } from "@coinbase/agentkit";
import { CdpClient } from "@coinbase/cdp-sdk";
import { log } from "../log";
import { ADDRESS, WALLET_ID, type Call, type Chain, type Wallet } from "./types";

export interface CdpChainConfig {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  /** CDP paymaster endpoint for the network. Required for gas sponsorship. */
  paymasterUrl: string;
  /** Testnet only in this build. */
  networkId: "base-sepolia";
}

type Hex = `0x${string}`;

export class CdpChain implements Chain {
  readonly kind = "cdp" as const;
  readonly network: string;
  private readonly client: CdpClient;

  constructor(private readonly config: CdpChainConfig) {
    this.network = config.networkId;
    this.client = new CdpClient({ apiKeyId: config.apiKeyId, apiKeySecret: config.apiKeySecret, walletSecret: config.walletSecret });
  }

  async open(id: string, address?: string): Promise<Wallet> {
    if (!WALLET_ID.test(id)) throw new RangeError(`wallet id must match ${WALLET_ID}`);
    if (address !== undefined && !ADDRESS.test(address)) throw new RangeError("address must be 20 bytes of hex");
    const owner = await this.client.evm.getOrCreateAccount({ name: `servpit-${id}` });
    const provider = await CdpSmartWalletProvider.configureWithWallet({
      apiKeyId: this.config.apiKeyId,
      apiKeySecret: this.config.apiKeySecret,
      walletSecret: this.config.walletSecret,
      networkId: this.config.networkId,
      owner,
      address: address as Hex | undefined,
      paymasterUrl: this.config.paymasterUrl,
    });
    const smartAddress = provider.getAddress();
    log.info("cdp smart wallet ready", { id, address: smartAddress, ownerAddress: owner.address, network: this.network });

    return {
      id,
      address: smartAddress,
      getBalance: () => provider.getBalance(),
      send: async (calls: readonly Call[], idempotencyKey: string) => {
        const op = await this.client.evm.sendUserOperation({
          smartAccount: provider.smartAccount,
          network: this.config.networkId,
          calls: calls.map((c) => ({ to: c.to as Hex, value: c.value, data: c.data ?? "0x" })),
          paymasterUrl: this.config.paymasterUrl,
          idempotencyKey,
        });
        const result = await this.client.evm.waitForUserOperation({ smartAccountAddress: smartAddress as Hex, userOpHash: op.userOpHash });
        if (result.status !== "complete") {
          throw new Error(`user operation ${op.userOpHash} failed with status ${result.status}`);
        }
        return { userOpHash: op.userOpHash, txHash: result.transactionHash, status: "complete" as const };
      },
    };
  }

  /** Testnet only: asks the CDP faucet for ETH. Returns the faucet tx hash. */
  async requestFaucet(address: string): Promise<string> {
    const result = await this.client.evm.requestFaucet({ address: address as Hex, network: "base-sepolia", token: "eth" });
    return result.transactionHash;
  }
}
