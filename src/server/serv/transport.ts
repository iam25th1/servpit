// Real SERV transport: the OpenAI SDK pointed at the SERV gateway. SERV
// speaks the OpenAI chat completions protocol; the model behind it is
// whatever src/config/serv.ts names. This module is server only and is the
// single place the API key is read.

import OpenAI from "openai";
import type { ServConfig } from "@/config/serv";
import type { ChatRequest, ChatResponse, ChatTransport } from "./client";

export function createServTransport(apiKey: string, config: ServConfig): ChatTransport {
  const client = new OpenAI({ apiKey, baseURL: config.baseUrl, timeout: config.timeoutMs, maxRetries: 0 });
  return {
    async create(request: ChatRequest, options: { signal: AbortSignal; timeoutMs?: number }): Promise<ChatResponse> {
      // The SDK keeps a timeout of its own and it is the shorter of the two,
      // so a caller allowed more time by the client was still cut off here:
      // every bank call died on "Request timed out" while the client was
      // still waiting patiently. Passed per request rather than raised for
      // everyone, because the short one is what stops a slow agent holding up
      // the other five.
      const response = await client.chat.completions.create(request as unknown as Parameters<typeof client.chat.completions.create>[0], {
        signal: options.signal,
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      });
      return response as unknown as ChatResponse;
    },
  };
}
