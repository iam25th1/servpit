// What the last round did, and why: how long each phase took, what every agent
// decided and on what balance, what Marrow lent or refused, and which seats
// were wrecked and refilled.
//
// Plain Node, no tsx, so it runs on a production install. Reads the running
// site's own public feed, which carries nothing a viewer cannot already see.
//
//   npm run pit:status              (the site on port 7530)
//   PORT=3000 npm run pit:status

const port = process.env.PORT ?? "7530";
const res = await fetch(`http://localhost:${port}/api/arena`);
if (!res.ok) throw new Error(`the site answered ${res.status}; is it running on port ${port}?`);
const view = await res.json();
const round = view.last ?? view.round;
if (!round) {
  console.log("No round has finished yet.");
  process.exit(0);
}

console.log(`round ${round.roundId}`);
const phases = round.phases ?? [];
phases.forEach((mark, i) => {
  const next = phases[i + 1];
  const took = next ? `${((Date.parse(next.at) - Date.parse(mark.at)) / 1000).toFixed(1)}s` : "(last)";
  console.log(`  ${mark.phase.padEnd(9)} ${took.padStart(7)}  ${mark.reason ?? ""}`);
});

console.log("decisions");
for (const d of round.decisions ?? []) {
  console.log(`  ${String(d.name).padEnd(8)} ${d.enter ? "IN " : "out"} ${String(d.balance).padStart(6)} chips, owes ${d.debt}  [${d.source}] ${d.reason}`);
}
for (const l of round.loans ?? []) console.log(`loan     ${l.name}: ${l.amount} chips at ${l.rateBps / 100}%`);
for (const r of round.refusals ?? []) console.log(`refused  ${r.name}: ${r.reason}`);
if (round.bank) console.log(`Marrow holds ${round.bank.treasury} chips`);
const result = round.result ?? {};
for (const w of result.wrecks ?? []) console.log(`wrecked  ${w.name}: ${w.trigger}`);
for (const r of result.replacements ?? []) console.log(`refill   ${r.name}: ${r.link ? "sent" : "NOT SENT, the operator wallet could not fund it"}`);
