import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERV, servModelId, type ServConfig } from "@/config/serv";
import { CostMeter, ServClient, ServError, type ChatTransport } from "./client";

const config = (patch: Partial<ServConfig> = {}): ServConfig => ({ ...DEFAULT_SERV, ...patch, backoffMs: 0 });

const reply = (content: string, usage = { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 }) => ({
  id: "cmpl-1",
  model: "claude-haiku-4.5",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage,
});

describe("servModelId", () => {
  it("appends multipath but not kronos by default", () => {
    expect(servModelId(DEFAULT_SERV)).toBe("claude-haiku-4.5-serv-multipath");
    expect(DEFAULT_SERV.features.kronos).toBe(false);
  });

  it("appends kronos only when enabled", () => {
    expect(servModelId(config({ features: { ...DEFAULT_SERV.features, kronos: true } }))).toBe("claude-haiku-4.5-serv-multipath-serv-kronos");
    expect(servModelId(config({ features: { promptGuard: true, shadowAgent: true, multipath: false, kronos: false } }))).toBe("claude-haiku-4.5");
  });
});

describe("ServClient request shape", () => {
  it("sends a system prompt, the suffixed model, json_schema response format and the SERV tools", async () => {
    const create = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    const client = new ServClient(config(), { create } as unknown as ChatTransport);
    await client.complete({ system: "you are an operator", user: "allocate", schemaName: "decision", schema: { type: "object" } });
    const body = create.mock.calls[0][0];
    expect(body.model).toBe("claude-haiku-4.5-serv-multipath");
    expect(body.messages[0]).toEqual({ role: "system", content: "you are an operator" });
    expect(body.messages[1]).toEqual({ role: "user", content: "allocate" });
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "decision", strict: true, schema: { type: "object" } } });
    const toolNames = body.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(toolNames).toEqual(["serv_prompt_guard", "serv_shadow_agent"]);
    const shadow = body.tools[1].function.parameters.properties;
    expect(shadow.hint.default).toBe(DEFAULT_SERV.shadowHint);
    expect(shadow.max_iterations.default).toBe(3);
    expect(body.temperature).toBe(0.2);
    expect(body.max_completion_tokens).toBe(400);
  });

  it("omits disabled tools", async () => {
    const create = vi.fn().mockResolvedValue(reply("{}"));
    const client = new ServClient(config({ features: { promptGuard: false, shadowAgent: false, multipath: false, kronos: false } }), { create } as unknown as ChatTransport);
    await client.complete({ system: "s", user: "u", schemaName: "d", schema: {} });
    expect(create.mock.calls[0][0].tools).toBeUndefined();
  });
});

describe("ServClient retries and failures", () => {
  it("retries a transient failure and succeeds", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("503 upstream")).mockResolvedValue(reply('{"ok":1}'));
    const client = new ServClient(config(), { create } as unknown as ChatTransport);
    const out = await client.complete({ system: "s", user: "u", schemaName: "d", schema: {} });
    expect(out.content).toBe('{"ok":1}');
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.attempts).toBe(2);
  });

  it("gives up after the configured attempts and throws a ServError naming the cause", async () => {
    const create = vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT"));
    const client = new ServClient(config({ attempts: 3 }), { create } as unknown as ChatTransport);
    await expect(client.complete({ system: "s", user: "u", schemaName: "d", schema: {} })).rejects.toThrow(ServError);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400 or a 401", async () => {
    for (const status of [400, 401]) {
      const err = Object.assign(new Error("bad"), { status });
      const create = vi.fn().mockRejectedValue(err);
      const client = new ServClient(config(), { create } as unknown as ChatTransport);
      await expect(client.complete({ system: "s", user: "u", schemaName: "d", schema: {} })).rejects.toThrow(ServError);
      expect(create).toHaveBeenCalledTimes(1);
    }
  });

  it("treats an empty choice as a failure", async () => {
    const create = vi.fn().mockResolvedValue({ ...reply(""), choices: [] });
    const client = new ServClient(config({ attempts: 1 }), { create } as unknown as ChatTransport);
    await expect(client.complete({ system: "s", user: "u", schemaName: "d", schema: {} })).rejects.toThrow(/no content/);
  });

  it("flags a prompt guard refusal distinctly", async () => {
    const create = vi.fn().mockResolvedValue({ ...reply("I cannot comply"), choices: [{ index: 0, message: { role: "assistant", content: "I cannot comply", refusal: "prompt_guard" }, finish_reason: "content_filter" }] });
    const client = new ServClient(config({ attempts: 1 }), { create } as unknown as ChatTransport);
    const out = await client.complete({ system: "s", user: "u", schemaName: "d", schema: {} });
    expect(out.guardRefusal).toBe(true);
  });
});

describe("CostMeter", () => {
  it("accumulates tokens and estimates cost in integer cents from the configured prices", () => {
    const meter = new CostMeter(DEFAULT_SERV.pricing);
    meter.record({ prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 });
    expect(meter.totals.promptTokens).toBe(1_000_000);
    expect(meter.estimatedCents).toBe(125);
    meter.record({ prompt_tokens: 0, completion_tokens: 2_000_000, total_tokens: 2_000_000 });
    expect(meter.estimatedCents).toBe(125 + 1_300);
    expect(meter.calls).toBe(2);
  });

  it("reports micro cents so a single cheap call is visible", () => {
    const meter = new CostMeter(DEFAULT_SERV.pricing);
    meter.record({ prompt_tokens: 1_200, completion_tokens: 150, total_tokens: 1_350 });
    expect(meter.estimatedMicroCents).toBe(Math.round((1_200 * 125 + 150 * 650) / 1_000_000 * 1_000_000) / 1);
    expect(meter.estimatedCents).toBe(0);
    expect(meter.summary()).toMatch(/2 calls|1 call/);
  });

  it("ignores a missing usage block rather than throwing", () => {
    const meter = new CostMeter(DEFAULT_SERV.pricing);
    meter.record(undefined);
    expect(meter.calls).toBe(1);
    expect(meter.totals.totalTokens).toBe(0);
  });
});
