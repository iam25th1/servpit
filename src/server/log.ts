// Structured server logging with mandatory redaction. Private keys, api
// keys, mnemonics and any registered secret value are masked before a line
// is written. Addresses (40 hex) pass through: they are the evidence.

export interface RedactOptions {
  secrets?: readonly string[];
}

const HEX64 = /0x[0-9a-fA-F]{64}/g;
const API_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const MNEMONIC = /\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b/g;

const registered: string[] = [];

/** Register a secret value so it can never appear in a log line. */
export function registerSecret(value: string | undefined): void {
  if (typeof value === "string" && value.length >= 4 && !registered.includes(value)) registered.push(value);
}

function redactString(s: string, secrets: readonly string[]): string {
  let out = s.replace(HEX64, "[redacted:hex64]").replace(API_KEY, "[redacted:key]").replace(MNEMONIC, "[redacted:mnemonic]");
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join("[redacted:secret]");
  }
  return out;
}

export function redact<T>(value: T, options: RedactOptions = {}): T {
  const secrets = [...registered, ...(options.secrets ?? [])];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redactString(v, secrets);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    if (typeof v === "bigint") return v.toString();
    return v;
  };
  return walk(value) as T;
}

type Level = "info" | "warn" | "error";

function write(level: Level, message: string, data?: unknown): void {
  const line = JSON.stringify(redact({ level, message, ...(data === undefined ? {} : { data }) }));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (message: string, data?: unknown) => write("info", message, data),
  warn: (message: string, data?: unknown) => write("warn", message, data),
  error: (message: string, data?: unknown) => write("error", message, data),
};
