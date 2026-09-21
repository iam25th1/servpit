// Reads server configuration from the environment once. Secret values are
// registered with the logger so they can never be printed, and nothing in
// here is importable from client code (a test enforces it).

import { parseEther } from "viem";
import { KEY_VARS, WALLET_IDS, keyVarFor } from "@/config/wallets";
import { registerSecret } from "./log";

type Hex = `0x${string}`;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

export interface ServerEnv {
  walletBackend: "fake" | "viem";
  /**
   * Whether the backend was named or worked out from which keys happen to be
   * present. A money surface must refuse to run on a guess: falling back to
   * the fake chain without saying so prints a plausible plan and moves
   * nothing, which looks exactly like success.
   */
  backendSource: "declared" | "inferred";
  network: string;
  dataDir: string;
  /** Private key per wallet id. Present only on the viem backend. */
  viem?: { keys: Record<string, Hex>; rpcUrl: string; gasReserveWei: bigint };
  serv?: { apiKey: string; model?: string };
  operatorToken?: string;
}

/**
 * The Base Sepolia endpoint.
 *
 * Default chosen by measurement rather than by reputation. Four endpoints
 * were given seven eth_getBalance calls back to back, which is the sweep the
 * funding script makes: publicnode answered all seven in 1.3 s, the chain's
 * own sepolia.base.org in 1.9 s, drpc in 3.3 s, and 1rpc.io returned
 * "unknown network" on every one. viem falls back to sepolia.base.org when
 * given nothing, which is what the funding run was using when it timed out.
 */
export const DEFAULT_RPC_URL = "https://base-sepolia-rpc.publicnode.com";

function rpcUrlFrom(env: NodeJS.ProcessEnv): string {
  // RPC_URL stays honoured so an existing setup keeps working.
  const raw = env.BASE_SEPOLIA_RPC_URL ?? env.RPC_URL;
  const url = raw?.trim();
  if (url === undefined || url.length === 0) return DEFAULT_RPC_URL;
  if (!/^https?:\/\//.test(url)) throw new RangeError("BASE_SEPOLIA_RPC_URL must be an http or https url");
  return url;
}

/**
 * ETH each wallet holds back for gas, and the floor an agent must clear on
 * top of its stake to be allowed into a round.
 *
 * Default 0.00002 ETH. Base Sepolia was quoting 0.006 gwei when this was
 * set, which puts a 21000 gas transfer at 0.000000126 ETH, so this covers
 * about 158 of them. The previous 0.0002 ETH covered 1587, and being ten
 * times the per wallet funding target it blocked every agent from entering:
 * a wallet funded to 0.0001 ETH cannot clear a 0.0002 ETH reserve.
 */
export const DEFAULT_GAS_RESERVE_ETH = "0.00002";

function gasReserveFrom(env: NodeJS.ProcessEnv): bigint {
  const raw = env.SERVPIT_GAS_RESERVE_ETH?.trim();
  const text = raw === undefined || raw.length === 0 ? DEFAULT_GAS_RESERVE_ETH : raw;
  let wei: bigint;
  try {
    wei = parseEther(text);
  } catch {
    throw new RangeError(`SERVPIT_GAS_RESERVE_ETH must be an amount in ETH, got ${text}`);
  }
  if (wei < 0n) throw new RangeError("SERVPIT_GAS_RESERVE_ETH cannot be negative");
  return wei;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  // Every key is registered with the logger before anything else can read it,
  // so even an accidental log of the whole environment is masked.
  for (const name of KEY_VARS) registerSecret(env[name]);
  for (const v of [env.SERV_API_KEY, env.OPERATOR_TOKEN]) registerSecret(v);

  const keys: Record<string, Hex> = {};
  const malformed: string[] = [];
  for (const id of WALLET_IDS) {
    const raw = env[keyVarFor(id)];
    if (raw === undefined || raw === "") continue;
    if (!PRIVATE_KEY.test(raw)) {
      malformed.push(keyVarFor(id));
      continue;
    }
    keys[id] = raw as Hex;
  }
  const missing = WALLET_IDS.filter((id) => keys[id] === undefined).map(keyVarFor);
  const viemReady = missing.length === 0 && malformed.length === 0;

  const requested = env.WALLET_BACKEND;
  if (requested !== undefined && requested !== "fake" && requested !== "viem") throw new RangeError("WALLET_BACKEND must be fake or viem");
  if (malformed.length > 0) {
    // Names only. The value is exactly what must not appear in an error.
    throw new Error(`these keys are not 32 byte hex: ${malformed.join(", ")}. Run npm run generate-wallets`);
  }
  if (requested === "viem" && !viemReady) {
    throw new Error(`WALLET_BACKEND=viem needs a key for every wallet, missing: ${missing.join(", ")}. Run npm run generate-wallets`);
  }
  const walletBackend = requested ?? (viemReady ? "viem" : "fake");

  return {
    walletBackend,
    backendSource: requested === undefined ? "inferred" : "declared",
    network: walletBackend === "viem" ? "base-sepolia" : "fake",
    dataDir: env.SERVPIT_DATA_DIR ?? "data",
    viem: walletBackend === "viem"
      ? { keys, rpcUrl: rpcUrlFrom(env), gasReserveWei: gasReserveFrom(env) }
      : undefined,
    serv: env.SERV_API_KEY ? { apiKey: env.SERV_API_KEY, model: env.SERV_MODEL } : undefined,
    operatorToken: env.OPERATOR_TOKEN,
  };
}
