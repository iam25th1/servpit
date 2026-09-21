import { describe, expect, it, vi } from "vitest";
import { NAMED_AGENTS } from "@/config/agents";
import { DEFAULT_SERV } from "@/config/serv";
import { CostMeter, ServClient, type ChatTransport } from "../serv/client";
import { DECISION_SCHEMA, FORBIDDEN_WORDS, MAX_REASON_WORDS, UNSUPPORTED_SCHEMA_KEYWORDS, buildPrompt, decideForAgents, heuristicDecision, reasonFault, schemaKeywords, validateDecision } from "./decide";
import type { AgentSnapshot } from "./types";

const snapshot = (patch: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  profile: NAMED_AGENTS[0],
  address: "0x" + "1".repeat(40),
  // Realistic wei: a chip is 10^12, so these are 100 chips held and 10 a seat.
  balanceWei: 100_000_000_000_000n,
  stakeWei: 10_000_000_000_000n,
  recentOutcomes: [],
  ...patch,
});

const round = { roundId: "round-1", participants: 24, poolWei: 240_000_000_000_000n, stakeWei: 10_000_000_000_000n };

const transportReturning = (content: string) =>
  ({
    create: vi.fn().mockResolvedValue({
      model: "claude-haiku-4.5",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 80, total_tokens: 980 },
    }),
  }) as unknown as ChatTransport;

describe("DECISION_SCHEMA", () => {
  it("requires exactly enter, stake and reason", () => {
    expect(DECISION_SCHEMA.required).toEqual(["enter", "stake", "reason"]);
    expect(DECISION_SCHEMA.additionalProperties).toBe(false);
    expect(DECISION_SCHEMA.properties.stake.type).toBe("integer");
    expect(DECISION_SCHEMA.properties.enter.type).toBe("boolean");
  });
});

describe("buildPrompt", () => {
  const { system, user } = buildPrompt(snapshot(), round);

  it("frames the task as resource allocation, never as wagering", () => {
    const text = `${system} ${user}`.toLowerCase();
    // Whole words. A substring check fails on "between", which is not a
    // wagering term and was never meant to be caught.
    for (const word of ["bet", "wager", "gamble", "odds", "casino", "jackpot"]) {
      expect(new RegExp(`\\b${word}\\b`).test(text), `framing used "${word}"`).toBe(false);
    }
    expect(text).toContain("allocat");
    expect(system).toMatch(/operator/i);
  });

  it("states the balance, the pool, the participant count and the strategy descriptor, in chips", () => {
    // Chips, not wei. A model handed 99868301341612 repeats it back.
    expect(user).toMatch(/You hold \d+ chips/);
    expect(user).toMatch(/costs \d+ chips/);
    expect(user).toContain("24");
    expect(user).toContain(NAMED_AGENTS[0].descriptor);
  });

  it("includes recent outcomes when there are any", () => {
    const { user: withHistory } = buildPrompt(snapshot({ recentOutcomes: [{ roundId: "r0", entered: true, netWei: -10_000_000_000_000n }] }), round);
    expect(withHistory).toMatch(/last few periods/i);
    // Told as chips lost, not a signed wei figure.
    expect(withHistory).toMatch(/lost \d+/);
  });
});

describe("validateDecision", () => {
  const snap = snapshot();

  it("accepts a well formed decision and keeps the integer stake", () => {
    const r = validateDecision('{"enter":true,"stake":10,"reason":"Plenty in the tank, I am in."}', snap);
    expect(r).toEqual({ ok: true, decision: { enter: true, stake: 10, reason: "Plenty in the tank, I am in." } });
  });

  it("rejects malformed json, wrong types, extra keys and a missing key", () => {
    for (const bad of [
      "not json",
      '{"enter":"yes","stake":1000,"reason":"x"}',
      '{"enter":true,"stake":10.5,"reason":"x"}',
      '{"enter":true,"stake":1000}',
      '{"enter":true,"stake":1000,"reason":"x","extra":1}',
      '{"enter":true,"stake":1000,"reason":""}',
      "[]",
      "null",
    ]) {
      expect(validateDecision(bad, snap).ok, bad).toBe(false);
    }
  });

  it("rejects a negative stake and a stake above the real on chain balance", () => {
    expect(validateDecision('{"enter":true,"stake":-1,"reason":"x"}', snap).ok).toBe(false);
    const overBalance = validateDecision('{"enter":true,"stake":99999999,"reason":"x"}', snap);
    expect(overBalance.ok).toBe(false);
    if (!overBalance.ok) expect(overBalance.reason).toMatch(/balance|stake/);
  });

  it("rejects a stake that is not the round stake when entering", () => {
    expect(validateDecision('{"enter":true,"stake":7,"reason":"x"}', snap).ok).toBe(false);
  });

  it("rejects entering when the balance cannot cover the stake", () => {
    expect(validateDecision('{"enter":true,"stake":10,"reason":"I am in."}', snapshot({ balanceWei: 10n })).ok).toBe(false);
  });

  it("requires stake zero when not entering", () => {
    expect(validateDecision('{"enter":false,"stake":0,"reason":"sitting out"}', snap).ok).toBe(true);
    expect(validateDecision('{"enter":false,"stake":1000,"reason":"x"}', snap).ok).toBe(false);
  });

  it("truncates an over long reason rather than rejecting it", () => {
    const r = validateDecision(`{"enter":false,"stake":0,"reason":"${"y".repeat(900)}"}`, snap);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decision.reason.length).toBeLessThanOrEqual(400);
  });
});

describe("heuristicDecision", () => {
  it("is deterministic for the same round and agent", () => {
    const a = heuristicDecision(snapshot(), round);
    expect(heuristicDecision(snapshot(), round)).toEqual(a);
    expect(a.stake).toBe(a.enter ? 1_000 : 0);
    expect(a.reason).toMatch(/heuristic/i);
  });

  it("never enters when the balance is below the minimum multiple", () => {
    const d = heuristicDecision(snapshot({ balanceWei: 15_000_000_000_000n }), round);
    expect(d.enter).toBe(false);
    expect(d.stake).toBe(0);
  });

  it("shifts with recent outcomes in the direction the strategy describes", () => {
    const chaser = NAMED_AGENTS.find((a) => a.strategy === "streak-chaser")!;
    const after = (netWei: bigint) => {
      let entered = 0;
      for (let i = 0; i < 40; i++) {
        const snap = snapshot({ profile: chaser, recentOutcomes: [{ roundId: `r${i}`, entered: true, netWei }] });
        if (heuristicDecision(snap, { ...round, roundId: `round-${i}` }).enter) entered++;
      }
      return entered;
    };
    expect(after(5_000n)).toBeGreaterThan(after(-1_000n));
  });
});

describe("decideForAgents", () => {
  const snaps = NAMED_AGENTS.map((profile, i) => snapshot({ profile, address: "0x" + String(i % 10).repeat(40) }));

  it("makes exactly one SERV call per named agent and reports source serv", async () => {
    const transport = transportReturning('{"enter":true,"stake":10,"reason":"Plenty in the tank, I am in."}');
    const meter = new CostMeter(DEFAULT_SERV.pricing);
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport), meter }, snaps, round);
    expect(out.decisions).toHaveLength(6);
    expect((transport.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6);
    for (const d of out.decisions) {
      expect(d.source).toBe("serv");
      expect(d.decision.enter).toBe(true);
      expect(d.decision.stake).toBe(10);
    }
    expect(meter.calls).toBe(6);
    expect(meter.totals.promptTokens).toBe(6 * 900);
  });

  it("falls back to the heuristic per agent when SERV is unreachable, and the round still proceeds", async () => {
    const transport = { create: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) } as unknown as ChatTransport;
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, attempts: 1, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.decisions).toHaveLength(6);
    for (const d of out.decisions) {
      expect(d.source).toBe("heuristic");
      expect(d.rejection).toMatch(/unreachable|ECONNREFUSED/);
      expect(d.decision).toEqual(heuristicDecision(snaps.find((s) => s.profile.id === d.agentId)!, round));
    }
  });

  it("falls back and records the rejection when SERV returns an invalid decision", async () => {
    const transport = transportReturning('{"enter":true,"stake":9999,"reason":"Taking everything."}');
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    for (const d of out.decisions) {
      expect(d.source).toBe("heuristic");
      expect(d.rejection).toMatch(/balance|stake/);
    }
    expect(out.rejections).toHaveLength(6);
  });

  it("works with no SERV client at all", async () => {
    const out = await decideForAgents({ client: undefined, meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.decisions.every((d) => d.source === "heuristic")).toBe(true);
    expect(out.decisions[0].rejection).toMatch(/not configured/i);
  });

  it("marks a prompt guard refusal distinctly and still falls back", async () => {
    const transport = {
      create: vi.fn().mockResolvedValue({
        model: "claude-haiku-4.5",
        choices: [{ index: 0, message: { role: "assistant", content: "I cannot help with that", refusal: "prompt_guard" }, finish_reason: "content_filter" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    } as unknown as ChatTransport;
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.guardRefusals).toBe(6);
    expect(out.decisions.every((d) => d.source === "heuristic")).toBe(true);
  });

  it("never lets a model decision exceed the on chain balance even when the model insists", async () => {
    const transport = transportReturning('{"enter":true,"stake":10,"reason":"Fine by me."}');
    const broke = [snapshot({ profile: NAMED_AGENTS[0], balanceWei: 5n })];
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, broke, round);
    expect(out.decisions[0].decision.enter).toBe(false);
    expect(out.decisions[0].decision.stake).toBe(0);
  });
});

describe("the response schema against SERV's validator", () => {
  it("uses no keyword the validator rejects", () => {
    // Every call failed with a 400 naming minimum. Probing the live
    // validator showed the rejected set is the numeric ranges and only
    // those, on both integer and number.
    const used = schemaKeywords(DECISION_SCHEMA);
    const banned = UNSUPPORTED_SCHEMA_KEYWORDS.filter((k) => used.has(k));
    expect(banned).toEqual([]);
  });

  it("finds a rejected keyword however deeply it is nested, so the check is not vacuous", () => {
    const nested = { type: "object", properties: { a: { type: "object", properties: { b: { type: "integer", minimum: 0 } } } } };
    expect(schemaKeywords(nested).has("minimum")).toBe(true);
    expect(UNSUPPORTED_SCHEMA_KEYWORDS.filter((k) => schemaKeywords(nested).has(k))).toEqual(["minimum"]);
  });

  it("keeps the types and the required fields, which are what strict mode needs", () => {
    expect(DECISION_SCHEMA.required).toEqual(["enter", "stake", "reason"]);
    expect(DECISION_SCHEMA.additionalProperties).toBe(false);
    expect(DECISION_SCHEMA.properties.enter.type).toBe("boolean");
    expect(DECISION_SCHEMA.properties.stake.type).toBe("integer");
    expect(DECISION_SCHEMA.properties.reason.type).toBe("string");
  });

  it("still says in words what the removed keyword meant", () => {
    // The bound is enforced by validateDecision. The description is what
    // tells the model, and losing it would make a rejection more likely
    // rather than less.
    expect(DECISION_SCHEMA.properties.stake.description).toContain("never negative");
  });
});

describe("the bounds the schema no longer expresses are still enforced", () => {
  const snap = snapshot({ balanceWei: 10_000n });

  it("rejects a negative stake, which is what minimum: 0 used to say", () => {
    const r = validateDecision('{"enter":false,"stake":-1,"reason":"x"}', snap);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("stake was not a non negative integer");
  });

  it("rejects a fractional stake, which is what type integer used to say", () => {
    expect(validateDecision('{"enter":false,"stake":1.5,"reason":"x"}', snap).ok).toBe(false);
  });

  it("rejects a stake above the balance read from the chain", () => {
    const r = validateDecision('{"enter":true,"stake":2000,"reason":"Going big."}', snap);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("chips this wallet holds");
  });

  it("rejects a stake that is not this round's allocation", () => {
    expect(validateDecision('{"enter":true,"stake":5,"reason":"x"}', snap).ok).toBe(false);
  });

  it("rejects a non zero stake when holding", () => {
    expect(validateDecision('{"enter":false,"stake":100,"reason":"x"}', snap).ok).toBe(false);
  });
});

describe("the failure that shipped", () => {
  const snaps = NAMED_AGENTS.map((profile, i) => snapshot({ profile, address: "0x" + String(i % 10).repeat(40) }));

  /** The exact error SERV returned on every call before the schema was fixed. */
  const schemaRejection = () => {
    const e = new Error("400 response_format.json_schema.schema: For 'integer' type, property 'minimum' is not supported");
    (e as unknown as { status: number }).status = 400;
    return e;
  };

  it("falls back to the heuristic on a schema rejection and the round still proceeds", async () => {
    const transport = { create: vi.fn().mockRejectedValue(schemaRejection()) } as unknown as ChatTransport;
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, attempts: 1, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.decisions).toHaveLength(6);
    for (const d of out.decisions) {
      expect(d.source).toBe("heuristic");
      expect(d.rejection).toContain("is not supported");
      expect(d.decision).toEqual(heuristicDecision(snaps.find((s) => s.profile.id === d.agentId)!, round));
    }
    expect(out.rejections).toHaveLength(6);
  });

  it("does not retry a 400, because a rejected schema is rejected every time", async () => {
    // Three attempts against a permanent error is three times the latency
    // for the same answer.
    const transport = { create: vi.fn().mockRejectedValue(schemaRejection()) } as unknown as ChatTransport;
    await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, attempts: 3, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect((transport.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6);
  });

  it("counts the call even when it failed, so the cost report cannot hide a broken run", async () => {
    const transport = { create: vi.fn().mockRejectedValue(schemaRejection()) } as unknown as ChatTransport;
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, attempts: 1, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.servCalls).toBe(6);
  });
});

describe("the six agents decide at once", () => {
  const snaps = NAMED_AGENTS.map((profile, i) => snapshot({ profile, address: "0x" + String(i % 10).repeat(40) }));

  /** A transport that holds every call open until released. */
  const gated = () => {
    let release: () => void = () => {};
    const open = new Promise<void>((r) => { release = r; });
    let inFlight = 0;
    let peak = 0;
    const transport = {
      create: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await open;
        inFlight--;
        return {
          model: "claude-haiku-4.5",
          choices: [{ index: 0, message: { role: "assistant", content: '{"enter":true,"stake":10,"reason":"Plenty in the tank, I am in."}' } }],
          usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
        };
      }),
    } as unknown as ChatTransport;
    return { transport, release: () => release(), peak: () => peak };
  };

  it("has all six calls in flight together, not one after another", async () => {
    // Sequentially the peak is one. Six sequential live calls measured 61
    // seconds of empty panel in the browser.
    const g = gated();
    const run = decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, g.transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    await vi.waitFor(() => expect(g.peak()).toBe(6));
    g.release();
    await run;
  });

  it("reports each agent the moment it lands, before the others finish", async () => {
    const seen: string[] = [];
    const transport = transportReturning('{"enter":true,"stake":10,"reason":"Plenty in the tank, I am in."}');
    await decideForAgents(
      { client: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) },
      snaps,
      round,
      (d) => seen.push(d.agentId),
    );
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("keeps the result in snapshot order however the network ordered the answers", async () => {
    // Entrant order decides who is who in the round. It must not depend on
    // which agent's request came back first.
    const order = [...snaps].map((s) => s.profile.id);
    let n = 0;
    const transport = {
      create: vi.fn(async () => {
        // Later calls resolve first.
        await new Promise((r) => setTimeout(r, (6 - n++) * 5));
        return {
          model: "claude-haiku-4.5",
          choices: [{ index: 0, message: { role: "assistant", content: '{"enter":false,"stake":0,"reason":"Sitting this one out."}' } }],
          usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
        };
      }),
    } as unknown as ChatTransport;
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.decisions.map((d) => d.agentId)).toEqual(order);
  });

  it("still counts calls, refusals and rejections correctly when they run together", async () => {
    const transport = { create: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) } as unknown as ChatTransport;
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, attempts: 1, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.servCalls).toBe(6);
    expect(out.rejections).toHaveLength(6);
    expect(out.guardRefusals).toBe(0);
    expect(out.decisions.every((d) => d.source === "heuristic")).toBe(true);
  });

  it("lets one agent fail without touching the other five", async () => {
    let call = 0;
    const transport = {
      create: vi.fn(async () => {
        if (call++ === 2) throw new Error("connect ECONNREFUSED");
        return {
          model: "claude-haiku-4.5",
          choices: [{ index: 0, message: { role: "assistant", content: '{"enter":true,"stake":10,"reason":"Plenty in the tank, I am in."}' } }],
          usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
        };
      }),
    } as unknown as ChatTransport;
    const out = await decideForAgents({ client: new ServClient({ ...DEFAULT_SERV, attempts: 1, backoffMs: 0 }, transport), meter: new CostMeter(DEFAULT_SERV.pricing) }, snaps, round);
    expect(out.decisions.filter((d) => d.source === "serv")).toHaveLength(5);
    expect(out.decisions.filter((d) => d.source === "heuristic")).toHaveLength(1);
  });
});

describe("the register the player sees", () => {
  const snap = snapshot();

  it("accepts a short sentence in a person's voice", () => {
    for (const reason of ["Lost three straight. Sitting this one out.", "Plenty in the tank, I am in.", "Everyone is cautious, so I am going big."]) {
      expect(reasonFault(reason)).toBeNull();
    }
  });

  it("refuses the jargon that was reaching the screen", () => {
    // This is the sentence that shipped: unreadable, and quoting a number
    // nobody can hold in their head.
    expect(reasonFault("Working balance of 99868301341612 minor units comfortably covers the 100 minor unit allocation under capital-preservation posture.")).not.toBeNull();
    for (const word of FORBIDDEN_WORDS) {
      expect(reasonFault(`I checked my ${word} and I am in.`), word).not.toBeNull();
    }
  });

  it("refuses a raw number, which is what made the old line unreadable", () => {
    expect(reasonFault("I hold 99868301341612 and I am in.")).toContain("99868301341612");
    // Four digits is fine: a chip count or a pool size can be that long.
    expect(reasonFault("The pool is 2400 chips, I am in.")).toBeNull();
  });

  it("refuses a speech rather than a sentence", () => {
    const long = `I ${"really ".repeat(MAX_REASON_WORDS)} am in.`;
    expect(reasonFault(long)).toContain("word limit");
  });

  it("does not catch a word that merely contains a banned one", () => {
    // "allocation" is banned; "location" is not, and neither is "between".
    expect(reasonFault("Good location for a fight, I am in.")).toBeNull();
    expect(reasonFault("Split between all of us, so I am in.")).toBeNull();
  });

  it("rejects the whole decision when the wording is wrong, not just the wording", () => {
    // The validator is the net that guarantees it never reaches the screen.
    // Shadow Agent gets the first chance and is not relied on.
    const r = validateDecision('{"enter":true,"stake":10,"reason":"My working balance covers the allocation."}', snap);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/working balance|allocation/);
  });

  it("keeps a good decision intact", () => {
    const r = validateDecision('{"enter":false,"stake":0,"reason":"Lost three straight. Sitting this one out."}', snap);
    expect(r).toEqual({ ok: true, decision: { enter: false, stake: 0, reason: "Lost three straight. Sitting this one out." } });
  });
});
