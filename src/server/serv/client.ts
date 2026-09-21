// SERV Reasoning client. OpenAI SDK shape pointed at SERV's OpenAI
// compatible gateway, because SERV speaks that protocol; the model behind
// it is chosen by config. Server side only: SERV_API_KEY never leaves this
// process, and a test fails if it reaches a client bundle.
//
// SERV features are requested two ways, per the SERV docs:
//   tools        serv_prompt_guard (no parameters) and serv_shadow_agent
//                (hint and max_iterations carried as schema defaults).
//   model suffix -serv-multipath and -serv-kronos.

import type { ServConfig } from "@/config/serv";
import { servModelId } from "@/config/serv";
import { log } from "../log";

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature?: number;
  max_completion_tokens?: number;
  response_format?: unknown;
  tools?: unknown[];
}

export interface ChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ index?: number; message?: { role?: string; content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  usage?: Usage;
}

export interface ChatTransport {
  create(request: ChatRequest, options: { signal: AbortSignal }): Promise<ChatResponse>;
}

export class ServError extends Error {
  constructor(message: string, readonly attempts: number, readonly cause?: unknown) {
    super(message);
    this.name = "ServError";
  }
}

export interface CompleteInput {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface CompleteOutput {
  content: string;
  usage?: Usage;
  model?: string;
  attempts: number;
  /** finish_reason or refusal indicates Prompt Guard stopped the request. */
  guardRefusal: boolean;
  latencyMs: number;
}

const NO_RETRY_STATUS = new Set([400, 401, 403, 404, 422]);

function statusOf(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

function servTools(config: ServConfig): unknown[] | undefined {
  const tools: unknown[] = [];
  if (config.features.promptGuard) {
    tools.push({ type: "function", function: { name: "serv_prompt_guard" } });
  }
  if (config.features.shadowAgent) {
    tools.push({
      type: "function",
      function: {
        name: "serv_shadow_agent",
        parameters: {
          type: "object",
          properties: {
            hint: { type: "string", default: config.shadowHint },
            max_iterations: { type: "integer", default: config.shadowMaxIterations },
          },
        },
      },
    });
  }
  return tools.length > 0 ? tools : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ServClient {
  constructor(private readonly config: ServConfig, private readonly transport: ChatTransport) {}

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    const request: ChatRequest = {
      model: servModelId(this.config),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: this.config.temperature,
      max_completion_tokens: this.config.maxCompletionTokens,
      response_format: { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.schema } },
    };
    const tools = servTools(this.config);
    if (tools) request.tools = tools;

    const started = Date.now();
    let lastError: unknown;
    for (let attempt = 1; attempt <= Math.max(1, this.config.attempts); attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.transport.create(request, { signal: controller.signal });
        const choice = response.choices?.[0];
        const content = choice?.message?.content;
        const guardRefusal = Boolean(choice?.message?.refusal) || choice?.finish_reason === "content_filter";
        if (typeof content !== "string" || content.length === 0) {
          throw new ServError(`SERV returned no content (finish_reason ${String(choice?.finish_reason)})`, attempt);
        }
        return { content, usage: response.usage, model: response.model, attempts: attempt, guardRefusal, latencyMs: Date.now() - started };
      } catch (e) {
        lastError = e;
        const status = statusOf(e);
        const retryable = status === undefined || !NO_RETRY_STATUS.has(status);
        log.warn("serv call failed", { attempt, status, retryable, error: e instanceof Error ? e.message : String(e) });
        if (!retryable || attempt >= Math.max(1, this.config.attempts)) break;
        await sleep(this.config.backoffMs * attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ServError(`SERV unreachable after ${this.config.attempts} attempts: ${message}`, this.config.attempts, lastError);
  }
}

export type { Totals } from "./meter";

/** Running token and cost estimate. Integer arithmetic on micro cents. */
export { CostMeter } from "./meter";

