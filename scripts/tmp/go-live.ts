// Real rounds on Base Sepolia with the bank on, until every bank path has
// been seen at least once. No scripted transport, no fake chain: this is the
// same plan and settle the app runs.
//
// Prints one block per round and writes the whole thing to a JSON file so the
// hashes can be quoted afterwards.

import { appendFileSync, writeFileSync } from "node:fs";
import { loadLocalEnv } from "../lib/loadEnv";
loadLocalEnv();
import { requireDeclaredBackend } from "../lib/requireBackend";
import { readEnv } from "../../src/server/env";
import { getServerContext } from "../../src/server/context";
import { planRound, runRound } from "../../src/server/round/flow";
import { toChips } from "../../src/config/stake";
import { basescanTx } from "../../src/server/money";

const envFile = loadLocalEnv();

interface Seen {
  borrowedAboveBase: boolean;
  garnishedWin: boolean;
  wreckWithSeizure: boolean;
  emptySeatLeftEmpty: boolean;
  fundedReplacement: boolean;
}

async function main(): Promise<void> {
  requireDeclaredBackend(readEnv(), envFile);
  const rounds = Number.parseInt(process.argv[2] ?? "20", 10);
  const entrants = Number.parseInt(process.argv[3] ?? "16", 10);
  const out = process.argv[4] ?? "/private/tmp/claude-501/-Users-25th/4c63ce26-734c-42e2-9b50-f433f91fbab3/scratchpad/go-live.json";
  const ctx = await getServerContext();
  const flow = { ...ctx.flow, entrants };
  const link = (hash: string | null | undefined): string | null => (hash ? basescanTx(ctx.chain.network, hash) : null);

  const seen: Seen = { borrowedAboveBase: false, garnishedWin: false, wreckWithSeizure: false, emptySeatLeftEmpty: false, fundedReplacement: false };
  const log: unknown[] = [];

  for (let i = 1; i <= rounds; i++) {
    const seed = `live-${Date.now().toString(36)}-${i}`;
    const before = ctx.flow.meter.estimatedMicroCents;
    let plan;
    try {
      plan = await planRound(flow, seed);
    } catch (e) {
      console.log(`round ${i} PLAN FAILED: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // Read before the settle, because a wreck reads it to decide whether a
    // seat can be refilled.
    const operatorWei = ctx.wallets.operator ? await ctx.bankroll.get(ctx.wallets.operator) : 0n;

    let run;
    try {
      run = await runRound(flow, plan);
    } catch (e) {
      console.log(`round ${i} SETTLE FAILED: ${e instanceof Error ? e.message : String(e)}`);
      log.push({ seed, error: e instanceof Error ? e.message : String(e) });
      writeFileSync(out, JSON.stringify(log, null, 2));
      continue;
    }

    const servMicroCents = ctx.flow.meter.estimatedMicroCents - before;
    const entered = plan.entering.map((e) => ({ agentId: e.agentId, stakeChips: toChips(e.stakeWei), loanChips: e.loanWei ? toChips(e.loanWei) : 0 }));
    const aboveBase = plan.entering.filter((e) => e.stakeWei > plan.stakeWei && (e.loanWei ?? 0n) > 0n);
    if (aboveBase.length > 0) seen.borrowedAboveBase = true;
    if (run.repayment) seen.garnishedWin = true;
    if (run.wrecks.some((w) => BigInt(w.seizedWei) > 0n)) seen.wreckWithSeizure = true;
    if (run.wrecks.length > 0 && run.replacements.some((r) => r.fundedWei === 0n)) seen.emptySeatLeftEmpty = true;
    if (run.replacements.some((r) => r.fundedWei > 0n)) seen.fundedReplacement = true;

    const record = {
      round: i,
      seed,
      roundId: plan.roundId,
      entrants,
      operatorChipsBeforeSettle: toChips(operatorWei),
      decisions: plan.decisions.map((d) => ({ agentId: d.agentId, name: d.name, source: d.source, enter: d.decision.enter, stake: d.decision.stake, reason: d.decision.reason, balanceChips: toChips(d.balanceWei), debtChips: toChips(d.debtWei ?? 0n) })),
      loanDecisions: plan.loans.map((l) => ({ agentId: l.agentId, name: l.name, askedChips: toChips(l.askedWei), amountChips: toChips(l.principalWei), rateBps: l.rateBps, reason: l.reason, source: l.source, rejection: l.rejection ?? null, model: l.model ?? null })),
      refusals: plan.refusals.map((r) => ({ agentId: r.agentId, name: r.name, reason: r.reason, askedChips: toChips(r.askedWei) })),
      entered,
      loans: run.loans.map((l) => ({ agentId: l.agentId, chips: toChips(l.amountWei), txHash: l.txHash, link: link(l.txHash) })),
      entries: run.entries.map((e) => ({ agentId: e.agentId, chips: toChips(e.amountWei), txHash: e.txHash, link: link(e.txHash) })),
      payout: run.payout ? { agentId: run.payout.agentId, chips: toChips(run.payout.amountWei), txHash: run.payout.txHash, link: link(run.payout.txHash) } : null,
      interest: run.interest.map((i2) => ({ agentId: i2.agentId, chargedChips: toChips(i2.chargedWei), rateBps: i2.rateBps })),
      repayment: run.repayment
        ? {
            agentId: run.repayment.agentId,
            interestChips: toChips(run.repayment.interestWei),
            principalChips: toChips(run.repayment.principalWei),
            paidChips: toChips(run.repayment.outcome.amountWei),
            txHash: run.repayment.outcome.txHash,
            link: link(run.repayment.outcome.txHash),
          }
        : null,
      wrecks: run.wrecks.map((w) => ({ walletId: w.walletId, name: w.name, trigger: w.trigger, debtChips: toChips(BigInt(w.debtAtDeathWei)), seizedChips: toChips(BigInt(w.seizedWei)), writtenOffChips: toChips(BigInt(w.writtenOffWei)) })),
      seizures: run.seizures.map((s) => ({ agentId: s.agentId, chips: toChips(s.amountWei), txHash: s.txHash, link: link(s.txHash) })),
      replacements: run.replacements.map((r) => ({ walletId: r.walletId, name: r.name, fundedChips: toChips(r.fundedWei), txHash: r.outcome?.txHash ?? null, link: link(r.outcome?.txHash) })),
      winner: run.round.placements[0],
      reconciled: run.reconciliation.ok,
      checks: run.reconciliation.checks.map((c) => ({ name: c.name, ok: c.ok, expected: c.expected, actual: c.actual })),
      servMicroCents,
    };
    log.push(record);
    writeFileSync(out, JSON.stringify(log, null, 2));

    const line = [
      `round ${i} ${plan.roundId} winner ${record.winner}`,
      `in ${entered.length}`,
      `loans ${record.loans.length}`,
      `repay ${record.repayment ? record.repayment.paidChips : 0}`,
      `wrecks ${record.wrecks.length}`,
      `reconciled ${record.reconciled}`,
      `serv ${(servMicroCents / 100_000_000).toFixed(5)} usd`,
    ].join(" | ");
    console.log(line);
    appendFileSync(`${out}.log`, `${line}\n`);

    if (Object.values(seen).filter((v, idx) => idx < 4).every(Boolean)) {
      console.log("every path seen, stopping");
      break;
    }
  }
  console.log("seen:", JSON.stringify(seen));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
