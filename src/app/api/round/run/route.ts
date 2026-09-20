// POST /api/round/run: plans, collects entries, resolves the round, pays
// the winner and reconciles against chain balances. This route moves money,
// so it is idempotent by round id: the same seed and entrant count key the
// same transfers and a retry never double pays.

import { NextResponse } from "next/server";
import { getServerContext } from "@/server/context";
import { basescanAddress } from "@/server/money";
import { planRound, runRound } from "@/server/round/flow";
import { parseRoundRequest } from "../plan/params";

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
  const run = await runRound(flow, plan);
  const stored = ctx.flow.store.get(plan.roundId);
  const link = (address: string) => (ctx.chain.settles ? basescanAddress(ctx.chain.network, address) : null);

  return NextResponse.json({
    roundId: plan.roundId,
    seed: plan.seed,
    network: ctx.chain.network,
    backend: ctx.chain.kind,
    entrants: plan.entrants.map((e) => e.id),
    winner: run.round.placements[0],
    potWei: run.round.pot.toString(),
    rakeWei: run.round.rake.toString(),
    potAddress: ctx.wallets.pot.address,
    potLink: link(ctx.wallets.pot.address),
    reconciled: run.reconciliation.ok,
    checks: run.reconciliation.checks,
    servCalls: plan.servCalls,
    guardRefusals: plan.guardRefusals,
    costMicroCents: ctx.flow.meter.estimatedMicroCents,
    costSummary: ctx.flow.meter.summary(),
    transfers: [
      ...run.entries.map((e) => ({ kind: e.kind, agentId: e.agentId, amountWei: e.amountWei.toString(), txHash: e.txHash ?? null, link: e.link, applied: e.applied })),
      ...(run.payout ? [{ kind: run.payout.kind, agentId: run.payout.agentId, amountWei: run.payout.amountWei.toString(), txHash: run.payout.txHash ?? null, link: run.payout.link, applied: run.payout.applied }] : []),
    ],
    agents: stored?.agents ?? [],
    // The event log the phase 2 renderer replays, and the reel draws the slot
    // screen shows. Both come from the same resolved round, so the symbols on
    // the machine are the entrants real draws rather than decoration.
    replay: { characters: run.round.characters, log: run.round.log, placements: run.round.placements },
    reels: run.round.reels.map((pull, i) => ({ entrantId: plan.entrants[i].id, symbols: pull.symbols, characterId: pull.characterId, tier: pull.characterTier, combo: pull.combo, bonusPct: pull.bonusPct })),
  });
}
