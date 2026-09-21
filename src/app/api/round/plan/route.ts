// POST /api/round/plan: reads every agent's balance from chain, runs the
// SERV decision loop, and returns each agent's decision and reason for the
// reasoning surface. Reads only. No money moves here.
//
// The response is newline delimited JSON rather than one object: a line per
// agent as it reports, then a final line carrying the whole plan. The six
// agents decide concurrently, so the phase lasts as long as the slowest of
// them rather than the sum, and streaming is the other half of that. An
// agent that answered in nine seconds should not be held back because
// another is on its second attempt. Holding everything until the last one
// landed measured 61 seconds of an empty panel in the browser.

import { toChips, weiPerChip } from "@/config/stake";
import { getServerContext } from "@/server/context";
import type { AgentDecision } from "@/server/decisions/types";
import { basescanAddress } from "@/server/money";
import { planRound, type RoundPlan } from "@/server/round/flow";
import { parseRoundRequest } from "./params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Linker = (address: string) => string | null;

/** One agent as the reasoning panel needs it. */
function decisionShape(d: AgentDecision, link: Linker) {
  return {
    agentId: d.agentId,
    name: d.name,
    strategy: d.strategy,
    address: d.address,
    link: link(d.address),
    balanceWei: d.balanceWei.toString(),
    enter: d.decision.enter,
    stake: d.decision.stake,
    reason: d.decision.reason,
    source: d.source,
    rejection: d.rejection ?? null,
    model: d.model ?? null,
    latencyMs: d.latencyMs ?? null,
  };
}

function planShape(plan: RoundPlan, network: string, kind: string, costMicroCents: number, costSummary: string, link: Linker) {
  return {
    roundId: plan.roundId,
    seed: plan.seed,
    network,
    backend: kind,
    stakeWei: plan.stakeWei.toString(),
    stakeChips: toChips(plan.stakeWei),
    weiPerChip: weiPerChip().toString(),
    entrants: plan.entrants.length,
    bots: plan.bots.length,
    servCalls: plan.servCalls,
    guardRefusals: plan.guardRefusals,
    costMicroCents,
    costSummary,
    decisions: plan.decisions.map((d) => decisionShape(d, link)),
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = parseRoundRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const ctx = await getServerContext();
  const flow = { ...ctx.flow, entrants: parsed.entrants };
  const link: Linker = (address) => (ctx.chain.settles ? basescanAddress(ctx.chain.network, address) : null);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: unknown): void => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        const plan = await planRound(flow, parsed.seed, (d) => line({ type: "decision", decision: decisionShape(d, link) }));
        // Quoted, so settling this round reuses these decisions rather than
        // running the whole loop again against a model that may answer
        // differently the second time.
        ctx.flow.plans?.put(plan);
        line({ type: "plan", plan: planShape(plan, ctx.chain.network, ctx.chain.kind, ctx.flow.meter.estimatedMicroCents, ctx.flow.meter.summary(), link) });
      } catch (e) {
        // The client needs a terminal line whatever happens, or it waits on a
        // stream that has already stopped producing.
        line({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Stops a proxy buffering the whole body, which would undo the point.
      "x-accel-buffering": "no",
    },
  });
}
