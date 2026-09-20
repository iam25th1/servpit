// POST /api/round/plan: reads every agent's balance from chain, runs the
// SERV decision loop, and returns each agent's decision and reason for the
// reasoning surface. Reads only. No money moves here.

import { NextResponse } from "next/server";
import { getServerContext } from "@/server/context";
import { basescanAddress } from "@/server/money";
import { planRound } from "@/server/round/flow";
import { parseRoundRequest } from "./params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = parseRoundRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const ctx = await getServerContext();
  const flow = { ...ctx.flow, entrants: parsed.entrants };
  const plan = await planRound(flow, parsed.seed);
  const link = (address: string) => (ctx.chain.settles ? basescanAddress(ctx.chain.network, address) : null);

  return NextResponse.json({
    roundId: plan.roundId,
    seed: plan.seed,
    network: ctx.chain.network,
    backend: ctx.chain.kind,
    stakeWei: plan.stakeWei.toString(),
    entrants: plan.entrants.length,
    bots: plan.bots.length,
    servCalls: plan.servCalls,
    guardRefusals: plan.guardRefusals,
    costMicroCents: ctx.flow.meter.estimatedMicroCents,
    costSummary: ctx.flow.meter.summary(),
    decisions: plan.decisions.map((d) => ({
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
    })),
  });
}
