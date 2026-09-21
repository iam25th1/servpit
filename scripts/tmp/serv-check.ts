// One call, to see whether the account has credit. No retries.
import { loadLocalEnv } from "../lib/loadEnv";
loadLocalEnv();
import { DEFAULT_SERV } from "../../src/config/serv";
import { ServClient } from "../../src/server/serv/client";
import { createServTransport } from "../../src/server/serv/transport";

async function main(): Promise<void> {
  const key = process.env.SERV_API_KEY;
  if (!key) {
    console.log("SERV_API_KEY is not set.");
    return;
  }
  const config = { ...DEFAULT_SERV, attempts: 1, timeoutMs: 20_000, maxCompletionTokens: 60, shadowMaxIterations: 1 };
  const client = new ServClient(config, createServTransport(key, config));
  try {
    const r = await client.complete({
      system: "Answer with a single JSON object.",
      user: "Reply with {\"ok\":true}.",
      schemaName: "probe",
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
    });
    console.log("SERV answered:", r.content.trim(), `| ${r.usage?.total_tokens ?? 0} tokens, ${r.latencyMs} ms`);
  } catch (e) {
    console.log("SERV failed:", (e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
}
main();
