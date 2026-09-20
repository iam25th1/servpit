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
    async create(request: ChatRequest, options: { signal: AbortSignal }): Promise<ChatResponse> {
      const response = await client.chat.completions.create(request as unknown as Parameters<typeof client.chat.completions.create>[0], { signal: options.signal });
      return response as unknown as ChatResponse;
    },
  };
}
