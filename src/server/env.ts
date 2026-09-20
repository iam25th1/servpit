// Reads server configuration from the environment once. Secret values are
// registered with the logger so they can never be printed, and nothing in
// here is importable from client code (a test enforces it).

import { KEY_VARS, WALLET_IDS, keyVarFor } from "@/config/wallets";
import { registerSecret } from "./log";

type Hex = `0x${string}`;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

export interface ServerEnv {
  walletBackend: "fake" | "viem";
  network: string;
  dataDir: string;
  /** Private key per wallet id. Present only on the viem backend. */
  viem?: { keys: Record<string, Hex>; rpcUrl?: string };
  serv?: { apiKey: string; model?: string };
  operatorToken?: string;
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
    network: walletBackend === "viem" ? "base-sepolia" : "fake",
    dataDir: env.SERVPIT_DATA_DIR ?? "data",
    viem: walletBackend === "viem" ? { keys, rpcUrl: env.RPC_URL } : undefined,
    serv: env.SERV_API_KEY ? { apiKey: env.SERV_API_KEY, model: env.SERV_MODEL } : undefined,
    operatorToken: env.OPERATOR_TOKEN,
  };
}
