// Reads server configuration from the environment once. Secret values are
// registered with the logger so they can never be printed, and nothing in
// here is importable from client code (a test enforces it).

import { registerSecret } from "./log";

export interface ServerEnv {
  walletBackend: "fake" | "cdp";
  network: string;
  dataDir: string;
  cdp?: { apiKeyId: string; apiKeySecret: string; walletSecret: string; paymasterUrl: string };
  serv?: { apiKey: string; model?: string };
  operatorToken?: string;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const cdpKeys = { apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET, walletSecret: env.CDP_WALLET_SECRET, paymasterUrl: env.PAYMASTER_URL };
  const cdpReady = Boolean(cdpKeys.apiKeyId && cdpKeys.apiKeySecret && cdpKeys.walletSecret && cdpKeys.paymasterUrl);
  const requested = env.WALLET_BACKEND;
  if (requested !== undefined && requested !== "fake" && requested !== "cdp") throw new RangeError("WALLET_BACKEND must be fake or cdp");
  if (requested === "cdp" && !cdpReady) throw new Error("WALLET_BACKEND=cdp needs CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET and PAYMASTER_URL");
  const walletBackend = requested ?? (cdpReady ? "cdp" : "fake");

  for (const v of [cdpKeys.apiKeySecret, cdpKeys.walletSecret, env.SERV_API_KEY, env.OPERATOR_TOKEN]) registerSecret(v);

  return {
    walletBackend,
    network: walletBackend === "cdp" ? "base-sepolia" : "fake",
    dataDir: env.SERVPIT_DATA_DIR ?? "data",
    cdp: walletBackend === "cdp" ? { apiKeyId: cdpKeys.apiKeyId!, apiKeySecret: cdpKeys.apiKeySecret!, walletSecret: cdpKeys.walletSecret!, paymasterUrl: cdpKeys.paymasterUrl! } : undefined,
    serv: env.SERV_API_KEY ? { apiKey: env.SERV_API_KEY, model: env.SERV_MODEL } : undefined,
    operatorToken: env.OPERATOR_TOKEN,
  };
}
