// Runs one full round end to end from the command line, exactly as the
// /api/round/run route does. Usage:
//
//   npm run round -- --seed demo --entrants 24
//
// WALLET_BACKEND decides which chain this touches and must be set. With
// WALLET_BACKEND=viem and the keys in .env.local this settles on
// base-sepolia and prints the transaction hashes; with fake it runs the same
// flow against the in memory chain. It used to guess, which meant a run
// with no keys loaded printed fake hashes and exited zero.

import { parseArgs } from "node:util";
import { getServerContext } from "../src/server/context";
import { readEnv } from "../src/server/env";
import { loadLocalEnv } from "./lib/loadEnv";
import { requireDeclaredBackend } from "./lib/requireBackend";
import { basescanTx } from "../src/server/money";
import { planRound, runRound } from "../src/server/round/flow";

// Before anything reads the environment.
const envFile = loadLocalEnv();

async function main(): Promise<void> {
  requireDeclaredBackend(readEnv(), envFile);

  const { values } = parseArgs({ options: { seed: { type: "string", default: "demo" }, entrants: { type: "string", default: "24" } } });
  const entrants = Number.parseInt(values.entrants, 10);
  if (!Number.isSafeInteger(entrants) || entrants < 16 || entrants > 32) throw new RangeError("--entrants must be an integer between 16 and 32");

  const ctx = await getServerContext();
  const flow = { ...ctx.flow, entrants };

  console.log(`backend ${ctx.chain.kind} on ${ctx.chain.network}`);
  console.log(`pot wallet ${ctx.wallets.pot.address}`);

  const plan = await planRound(flow, values.seed);
  console.log(`\nround ${plan.roundId}, ${plan.entrants.length} seats, ${plan.entering.length} agents entering, ${plan.bots.length} house bots`);
  console.log(`serv calls ${plan.servCalls}, guard refusals ${plan.guardRefusals}, ${ctx.flow.meter.summary()}`);
  for (const d of plan.decisions) {
    console.log(`  ${d.name.padEnd(6)} ${d.source.padEnd(9)} ${d.decision.enter ? `commits ${d.decision.stake}` : "holds".padEnd(13)}  balance ${d.balanceWei}`);
    console.log(`         reason: ${d.decision.reason}`);
    if (d.rejection) console.log(`         rejected: ${d.rejection}`);
  }

  const run = await runRound(flow, plan);
  console.log(`\nwinner ${run.round.placements[0]}, pot ${run.round.pot}, rake ${run.round.rake}`);
  for (const t of [...run.entries, ...(run.payout ? [run.payout] : [])]) {
    const link = ctx.chain.settles && t.txHash ? ` ${basescanTx(ctx.chain.network, t.txHash)}` : "";
    console.log(`  ${t.kind.padEnd(7)} ${t.agentId.padEnd(7)} ${t.amountWei} wei  ${t.applied ? "applied" : "already settled"}  ${t.txHash ?? "no hash"}${link}`);
  }
  console.log(`\nreconciliation ${run.reconciliation.ok ? "held against chain balances" : "FAILED"}`);
  for (const c of run.reconciliation.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}: expected ${c.expected}, actual ${c.actual}`);
  console.log(`\nserv usage: ${ctx.flow.meter.summary()}`);

}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
