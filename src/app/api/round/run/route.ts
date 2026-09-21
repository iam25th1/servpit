// POST /api/round/run: plans, collects entries, resolves the round, pays
// the winner and reconciles against chain balances. This route moves money,
// so it is idempotent by round id: the same seed and entrant count key the
// same transfers and a retry never double pays.

import { getSettleContext } from "@/server/settleContext";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";
import { basescanAddress } from "@/server/money";
import { weiPerChip } from "@/config/stake";
import { arrivalFor, faceFor } from "@/config/replacements";
import { entrantNames } from "@/server/round/entrantNames";
import { roundIdFor } from "@/server/round/types";
import { runRound } from "@/server/round/settle";
import { overReached } from "@/server/round/wrecks";
import { parseRoundRequest } from "../plan/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = parseRoundRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const ctx = await getSettleContext();
  const flow = { ...ctx.flow, entrants: parsed.entrants };

  // The plan this round was quoted with, if it is still good. Re-planning
  // here ran the decision loop a second time, which meant six more SERV calls
  // before a coin moved and a model free to answer differently than it did on
  // screen. Keyed by a round id the server derives from the seed and the
  // entrant count, so nothing a client sends can put decisions into it.
  const roundId = roundIdFor(parsed.seed, parsed.entrants);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: unknown): void => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        // Strictly the plan that was quoted. This route does not plan, does
        // not decide and does not call SERV: a guard test asserts it cannot
        // even import the code that would. A missing plan stops the settle.
        if (!flow.plans) throw new Error("no plan store, refusing to settle a round that was never quoted");
        const plan = flow.plans.require(roundId);
        const link = (address: string) => (ctx.chain.settles ? basescanAddress(ctx.chain.network, address) : null);
        const byId = new Map(plan.decisions.map((d) => [d.agentId, d.name]));

        // Each buy in as it confirms on chain. This is the slowest part of a
        // round and it used to be a frozen "Locked in": the wait is the same
        // length, but it is now the agents paying in one by one with their
        // transactions on screen rather than nothing at all.
        const run = await runRound(flow, plan, {
          onLoan: (agentId, outcome) =>
            line({
              type: "loan",
              loan: {
                agentId,
                name: byId.get(agentId) ?? agentId,
                amountWei: outcome.amountWei.toString(),
                txHash: outcome.txHash ?? null,
                link: outcome.link,
                applied: outcome.applied,
              },
            }),
          onEntry: (agentId, outcome) =>
            line({
              type: "entry",
              entry: {
                agentId,
                name: byId.get(agentId) ?? agentId,
                amountWei: outcome.amountWei.toString(),
                txHash: outcome.txHash ?? null,
                link: outcome.link,
                applied: outcome.applied,
              },
            }),
        });

        const stored = ctx.flow.store.get(plan.roundId);
        line({
          type: "result",
          result: {
            roundId: plan.roundId,
            seed: plan.seed,
            network: ctx.chain.network,
            backend: ctx.chain.kind,
            settles: ctx.chain.settles,
            entrants: plan.entrants.map((e) => e.id),
            winner: run.round.placements[0],
            // The pot is what agents actually paid in plus what rolled over,
            // not the engine's twenty four seat figure. The field is named
            // for wei and must carry wei: the result screen divides by
            // weiPerChip and showed a 240 chip pot as 0 when it did not.
            potWei: run.prize.poolWei.toString(),
            rakeWei: run.prize.rakeWei.toString(),
            rolloverInWei: run.rolloverInWei.toString(),
            nextRolloverWei: run.prize.nextRolloverWei.toString(),
            potAddress: ctx.wallets.pot.address,
            potLink: link(ctx.wallets.pot.address),
            weiPerChip: weiPerChip().toString(),
            reconciled: run.reconciliation.ok,
            checks: run.reconciliation.checks,
            servCalls: plan.servCalls,
            guardRefusals: plan.guardRefusals,
            costMicroCents: ctx.flow.meter.estimatedMicroCents,
            costSummary: ctx.flow.meter.summary(),
            transfers: [
              ...run.loans.map((l) => ({ kind: l.kind, agentId: l.agentId, amountWei: l.amountWei.toString(), txHash: l.txHash ?? null, link: l.link, applied: l.applied })),
              ...run.entries.map((e) => ({ kind: e.kind, agentId: e.agentId, amountWei: e.amountWei.toString(), txHash: e.txHash ?? null, link: e.link, applied: e.applied })),
              ...(run.payout ? [{ kind: run.payout.kind, agentId: run.payout.agentId, amountWei: run.payout.amountWei.toString(), txHash: run.payout.txHash ?? null, link: run.payout.link, applied: run.payout.applied }] : []),
              ...(run.retained ? [{ kind: "retained", agentId: run.retained.winnerEntrantId, amountWei: run.retained.amountWei.toString(), txHash: null, link: null, applied: false }] : []),
              // The garnishment is chips that moved, so it belongs in the
              // list that claims to hold every transfer this round, not only
              // in the winner's panel where it is explained.
              ...(run.repayment
                ? [
                    {
                      kind: run.repayment.outcome.kind,
                      agentId: run.repayment.agentId,
                      amountWei: run.repayment.outcome.amountWei.toString(),
                      txHash: run.repayment.outcome.txHash ?? null,
                      link: run.repayment.outcome.link,
                      applied: run.repayment.outcome.applied,
                    },
                  ]
                : []),
            ],
            // What the bank did this round. Empty with the flag off, so the
            // client renders nothing it did not render before.
            interest: run.interest.map((i) => ({ agentId: i.agentId, chargedWei: i.chargedWei.toString(), rateBps: i.rateBps })),
            repayment: run.repayment
              ? {
                  agentId: run.repayment.agentId,
                  name: byId.get(run.repayment.agentId) ?? run.repayment.agentId,
                  interestWei: run.repayment.interestWei.toString(),
                  principalWei: run.repayment.principalWei.toString(),
                  paidWei: run.repayment.outcome.amountWei.toString(),
                  link: run.repayment.outcome.link,
                }
              : null,
            wrecks: run.wrecks.map((w) => ({
              walletId: w.walletId,
              name: w.name,
              // The face it wore, from the identity that owned the seat, so
              // the screen shows who died rather than who is in the chair now.
              face: w.face ?? faceFor(w.walletId, w.identityId),
              trigger: w.trigger,
              overReached: overReached(w),
              debtAtDeathWei: w.debtAtDeathWei,
              seizedWei: w.seizedWei,
              writtenOffWei: w.writtenOffWei,
              peakBalanceWei: w.peakBalanceWei,
              borrowedWei: w.borrowedWei,
              roundsSurvived: w.roundsSurvived,
              wins: w.wins,
            })),
            replacements: run.replacements.map((r) => ({
              walletId: r.walletId,
              name: r.name,
              face: r.face,
              arrival: arrivalFor(r.walletId, r.identityId, r.occupantId) ?? "",
              fundedWei: r.fundedWei.toString(),
              link: r.outcome?.link ?? null,
            })),
            agents: stored?.agents ?? [],
            replay: {
              characters: run.round.characters,
              log: run.round.log,
              placements: run.round.placements,
              names: entrantNames(plan.entering, plan.decisions),
            },
            reels: run.round.reels.map((pull, i) => ({ entrantId: plan.entrants[i].id, symbols: pull.symbols, characterId: pull.characterId, tier: pull.characterTier, combo: pull.combo, bonusPct: pull.bonusPct })),
          },
        });
      } catch (e) {
        // Sanitized, for the same reason as the plan route: nothing a library
        // wrote reaches the browser.
        const shown = publicError(e);
        log.error("settle failed", { code: shown.code, detail: internalDetail(e) });
        line({ type: "error", ...shown, error: shown.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
