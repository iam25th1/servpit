<div align="center">

<img src="docs/hero.svg" alt="SERVPIT" width="880">

**A slot machine decides who fights. Six agents decide whether to pay for a seat.**

`SERV Reasoning` · `Coinbase AgentKit` · `Base Sepolia` · `Next.js` · `1556 tests`

[![ci](https://github.com/iam25th1/servpit/actions/workflows/ci.yml/badge.svg)](https://github.com/iam25th1/servpit/actions/workflows/ci.yml)

</div>

---

<!--
  TODO before submitting:
  1. Drag the demo mp4 into this README on github.com so GitHub hosts it, then paste the
     user-attachments URL below.
  2. Done: the deployment URL is under "Play it".
  (The settlement hashes are already full and linked to Basescan.)
-->

## Demo

<!-- paste the GitHub user-attachments video URL here, above this line -->

![The full player flow: lever, reels, handoff to the arena, result](docs/media/slot-flow.gif)

> Sixty seconds: pull the lever, watch six agents decide with their own money, watch the pit.
> The capture above is the same flow, recorded headlessly from the running app.

**Play it:** https://servpit.25th.dev

---

## What this is

You pull a lever. Three reels draw you a fighter. Twenty four fighters load into a pit and
kill each other without anyone playing. One walks out with the pot.

The part that makes it more than a toy: **six of those entrants are autonomous agents with
their own Base Sepolia wallets.** Before every round each one is asked whether to commit
capital and how much, given its own balance, the size of the pool, the number of
participants and its recent results. It answers through SERV Reasoning. If it says yes, it
pays its own entry from its own wallet, on chain, and the transaction is on Basescan.

Nobody stakes on its behalf. A broke agent cannot enter. An agent without gas is excluded
and told which of the two it was short on.

That is the lever flow, and it still works exactly as it did. With `SERVPIT_ARENA_MODE` on the
pit runs itself instead: a worker plays a round every interval, the house pulls the lever, and
everybody watching sees the same round at the same moment. The only thing a visitor does then
is back an agent for points, which are points and never money.

### Open Track, and where AgentKit actually sits

This is an **Open Track** submission. The agents reason with SERV Reasoning, and the money
moves through AgentKit's `ViemWalletProvider` on Base Sepolia. AgentKit is the wallet layer
and nothing else here, which is why this README does not present it as the agent framework:
**the model never calls a tool.**

Three steps, which this project deliberately does not collapse into one:

1. **The model answers.** It is asked a question and returns a decision, a small JSON object
   saying enter or hold and for how many chips, with one sentence of reasoning.
2. **An independent validator checks it** against the balance the process read from the chain
   a moment earlier. A stake that is negative, fractional, larger than the wallet holds, or
   not the round's allocation is rejected, and the agent falls back to the deterministic
   heuristic with the rejection recorded.
3. **Only then does ordinary code move funds**, from the agent's own wallet, with a hash.

That is a design choice rather than a limitation of the tools. A model holding a tool that
moves money is a model with a hand in the till: the answer and the transfer are one event, and
the only thing between a bad answer and a bad transfer is the model itself. Here the answer is
data until something that is not the model has checked it against the chain. When eighteen
consecutive SERV calls failed across three rounds settling real money, every one of them fell
through to the heuristic, every round settled, and reconciliation held on all of them. The
failure was a bug; surviving it was the design.

### What is shipped

All of it is running on the live pit rather than described here in the future tense.

- **The bank.** Marrow, a seventh agent that takes no seat, lends to the six from its own
  treasury on Base Sepolia, charges interest per round, is repaid from winnings, seizes and
  writes off.
- **Autonomous rounds.** A worker plays a round on its own interval, with no lever pulled and
  nobody watching needed.
- **The spectator view.** One round, one clock, the same moment for everybody, with a viewer
  who arrives mid fight seeking to the right frame rather than to the start.
- **Replay.** The last round can be watched again from the recording it left behind, with no
  SERV call and no chain call.
- **Backing and the leaderboard.** A window between the draw and the fight, pari mutuel
  points, and a paged board that is points and never money.
- **Pull to reason.** A visitor can spend the pit's reasoning on a round on demand, within
  limits the operator sets, while scheduled rounds keep running for free.
- **Learning from reasoned rounds.** A round nobody paid for draws each answer from what SERV
  decided for that agent in a spot like this one, and says that it did.
- **Claiming a fighter.** A visitor can take one house seat as their own, with a name and a
  face, and it enters every round from the next one.
- **The fighters board.** Rounds, wins, best placement, kills and a streak, kept apart from
  the backing board because a fighter's record is luck and a backer's is at least a judgement.
- **Music.** Two tracks, one for the pit between rounds and one for the fight, off until
  somebody asks for them.

**Where the live pit stood on 23 September 2026**, read from its own public endpoints rather
than from anybody's notes:

| | |
|---|---|
| network | Base Sepolia, worker alive, a round about every two minutes |
| the bank | 938 chips in the treasury, nothing out on loan |
| the graveyard | 11 agents retired and replaced |
| claimed fighters | 2 of 8 seats, 9 faces still free |
| the best fighter | 25THH, 53 rounds, 5 wins, 44 kills, longest run of 5 |
| backers | 6 handles on the board |
| reasoning | scheduled reasoning off, so rounds run on instinct until somebody pulls |

### The artifact

Six real decisions, from one settled round, `r-133cdbfe48371d2d`:

| agent | what it said | |
|---|---|---|
| **Atlas** | Two straight losses and a one-in-twenty shot don't justify risking capital right now. | held |
| **Blaze** | I'm in, odds are solid and I've got the chips to back it. | in |
| **Comet** | Just lost ten, so I'm sitting this one out to rebuild. | held |
| **Delta** | Everyone's scared after losses, so I'm stepping in while the odds favor the bold. | in |
| **Ember** | Steady rhythm, same as always, chips are there to use. | in |
| **Flint** | Twenty-four players and a fat pot, this is exactly my kind of game. | in |

Four committed, two held, each from its own balance and its own recent record. No heuristic in
this codebase produces those sentences.

They did not always read like that. The first version of this section quoted a real decision
that went out as:

> Recent results show three consecutive significant losses totaling over 395 billion minor
> units, warranting a hold decision under the easing-off posture despite the substantial
> working balance.

Correct, unreadable, and quoting a number nobody can hold in their head. The numbers given to
the model are chips now, and the answer has to be one short sentence in the agent's own voice.
Both the Shadow Agent criteria and an independent local validator enforce that, and an answer
that fails either falls back to the heuristic rather than going on screen.

---

## How a round works

```mermaid
flowchart TD
    A[Player pulls the lever] --> B[Six agents asked to decide]
    B --> C{SERV Reasoning}
    C -->|enter + stake| D[Independent validator]
    C -->|failure or budget spent| E[Deterministic heuristic]
    E --> D
    D -->|clamped to real on-chain balance| P[Plan persisted under a round id]
    D -->|rejected| G[Agent excluded, reason shown]
    P --> F[Entry transfer, agent wallet to pot]
    F --> H[Three reels draw a fighter per entrant]
    H --> I[Seeded resolver produces an event log]
    I --> J[Canvas plays the log back]
    J --> K[Payout transfer, pot to winner]
    K --> L[Reconcile against on-chain balances]
```

The fight itself never touches the chain and never touches a model. `resolveRound` is a pure
function of seed, entrant list and config, returning placements, payouts and an ordered
event log. The renderer animates the log. Money moves at the two ends only.

<details>
<summary><b>What the player sees is what settles, structurally</b></summary>

<br>

The plan, including every decision and every entry, is written once under a round id derived
from the seed and the entrant count. The settle endpoint takes that id and settles strictly
against what it finds. It may not plan, may not decide and may not call SERV.

That is not a convention. `test/settle-isolation.test.ts` walks the import graph from the
settle route and fails if it reaches the decision loop, the SERV client or the transport at
any depth, and a companion test asserts the plan route does reach them. A settle that wanted
to work out its own answer could not compile a path to the code that would.

The rule exists because the alternative shipped twice. The run endpoint used to re-plan,
which meant six more SERV calls before a coin moved, a model free to answer differently than
it did on screen, and 68.9 seconds of a frozen "Locked in".

</details>

---

## Live settlement

Forty one settled rounds on Base Sepolia, forty of them reconciled, counted on 21 September
2026. The one that did not is still on file, and why is below. On chain across those rounds:
150 entries, 7 payouts, 6 loans, 2 repayments, 1 seizure and 3 operator refills, every one of
them a transaction with a hash. The pit has kept playing since, which is what the graveyard
and the boards above count; these figures are the settled history as it was read off the round
store on that date, and they are not re-counted here because this README is written in a clone
that does not touch the live pit's data.

Round `r-42ee92f9c5b6f41e`, seed `hardening1`, is an agent win under the current prize model.
Four agents paid in 10 chips each, thirty chips had rolled over from a round nobody real won,
and Ember took all seventy.

| agent | decision | transaction |
|---|---|---|
| Atlas | **held** | no transaction |
| Blaze | **held** | no transaction |
| Comet | paid 10 chips | [`0x11ce59b4...0b23c489`](https://sepolia.basescan.org/tx/0x11ce59b4a98f9fad85111fc47a47374621b5ee33b7d7fafd5807d3480b23c489) |
| Delta | paid 10 chips | [`0xc3a1f617...c2957d70`](https://sepolia.basescan.org/tx/0xc3a1f617a166f70a113bee701d8d196b04c6f517092d43d768702bedc2957d70) |
| Ember | paid 10 chips, **won 70** | [`0x57d42ae0...5ab63df5`](https://sepolia.basescan.org/tx/0x57d42ae0de51649fe2054e5971ea5980d03ac0ac45d02d376a7ef2275ab63df5) · [payout `0x397dcbb7...81e6d3b2`](https://sepolia.basescan.org/tx/0x397dcbb744a3918f464bf33cae3c159328659373865e61b00ea44b2281e6d3b2) |
| Flint | paid 10 chips | [`0xec32f828...4bbbcfda`](https://sepolia.basescan.org/tx/0xec32f828e5dd13565a1edb59b50e3b59860f258910d1cb84560e29ad4bbbcfda) |

```
entries      40000000000000 wei (40 chips)
rollover in  30000000000000 wei (30 chips)
pool         70000000000000 wei (70 chips)
payout       70000000000000 wei (70 chips)
rollover out 0 wei

reconciliation held against chain balances
  ok   wallet 0xf9f5AA50...2B84E delta: expected 60000000000000, actual 60000000000000
  ok   pot delta: expected -30000000000000, actual -30000000000000
  ok   conservation: expected 70000000000000, actual 70000000000000
  ok   pot covers payout: expected at most 319713137301177, actual 70000000000000
```

Ember's balance went from 68168523639709 wei to 128036907148202, which is 70 chips in and one
gas fee out. The decisions in that round came from the heuristic, not SERV, because the SERV
credits had been spent measuring latency an hour earlier. The reasoning artifact above is from
a SERV round; this one is here for the money.

<details>
<summary><b>The prize used to be insolvent, and reconciliation is what said so</b></summary>

<br>

A round has twenty four seats and only five or six of them are agents with wallets. The prize
was `stake x 24`, charging every seat, while only the agents ever paid anything. The pot wallet
made up the difference out of its own balance on every agent win.

Measured on the live pot: it promised a 240 chip prize while agents paid in about 50 chips a
round, against roughly a one in four chance an agent wins. That is 60 chips expected out
against 50 in. The pot drained about 10 chips a round and had one payout left in it.

The prize is now entries plus rollover, which is money the pot is already holding. A seat that
did not pay adds nothing. A round nobody real wins leaves its whole prize in the pot as the
next round's jackpot, which is where Ember's extra 30 chips came from.

Conservation is now an equality on both branches, entries plus rollover in equals payout plus
rollover out plus rake, and a separate check asserts the pot never sends more than it holds.
The old check only asked that a retained prize was not negative, so a rollover that quietly
dropped part of the prize would have looked fine.

`r-4f1bed882155082a` is the round that is on file as unreconciled. It was the first time an
agent ever won, and the pot delta check had been written on the assumption that the pot only
ever receives, so it came up short by exactly the payout's gas fee. The check was wrong and the
money was right. It is left in the history rather than backfilled.

</details>

<details>
<summary><b>Why reconciliation is checked against receipts and not an estimate</b></summary>

<br>

Agents self-fund gas since the wallet layer moved to `ViemWalletProvider`, so a raw balance
delta includes fees the stake accounting knows nothing about. Base is an OP stack chain, so a
receipt carries an L1 data fee alongside the L2 gas and both come out of the sender. Within one
round the L1 fee was not even constant:

| agents | L1 fee, wei |
|---|---|
| three of them | 131945418609 |
| the other two | 132083263189 |

Any hardcoded constant would have failed. Reconciliation subtracts the actual fee from each
receipt, and still fails loudly if stake accounting is genuinely wrong.

</details>

<details>
<summary><b>The degradation path, proven the hard way</b></summary>

<br>

Before the schema fix landed, every SERV call returned `400 response_format.json_schema.schema:
For 'integer' type, property 'minimum' is not supported`. SERV's structured output validator
rejects numeric range keywords.

That produced eighteen consecutive live API failures across three rounds settling real money
on a real chain. Every one fell through to the deterministic heuristic. Not one round was
dropped, not one ledger was corrupted, and reconciliation held on every one of them.

The failure was a bug. Surviving it was the design. Those rounds are still in the history with
`servCalls: 6`, `servMicroCents: 0` and every agent recorded as `source: heuristic`, which is
what a fully degraded round looks like.

</details>

---

## The bank, live on Base Sepolia

`SERVPIT_BANK_ENABLED` is on. A seventh agent has joined the pit without taking a seat in it,
and it settles with real money: six loans, two repayments and one seizure on Base Sepolia, in
rounds that reconciled, every hash below on the block explorer. `docs/bank-live.md` is the full record, including what going live
found that a local chain could not.

Setting the flag to false gives back exactly the game that shipped in 12a: one fixed stake per
seat, no borrowing, no lender, and no screen that mentions one.

Marrow is the lender. It is asked one request at a time, it answers in JSON, and nothing it
says about money is believed: every bound on what it approves is checked against figures the
process read from the chain. It sits under the cabinet with its treasury, its book and its
latest ruling.

![The lineup with debt, and Marrow under the cabinet](docs/media/bank-lineup.png)

Each agent shows what it holds and, separately, what it owes. One number netting the two would
hide the thing worth seeing, which is an agent playing on borrowed chips.

![The buy in panel, with the round's lending as beats](docs/media/bank-beats.png)

A loan is an exchange rather than a log line: the ask, then the answer, then the reason in
Marrow's own voice. They stagger in as a sequence because an ask and its answer only read as an
exchange in that order.

In round [`r-4f99838371ef97f6`](https://sepolia.basescan.org/tx/0xc57090dd6bf1863c3a05413e1b2ae73583246821e945bca64325f03c46c62c4d)
three agents borrowed to put up more than the 10 chip seat: Blaze took
[19 chips](https://sepolia.basescan.org/tx/0xc57090dd6bf1863c3a05413e1b2ae73583246821e945bca64325f03c46c62c4d)
to stake 26, Flint took
[19](https://sepolia.basescan.org/tx/0xeced1705a98c69fa7dd3705b33ba8a98637fac62273a136abaf03be66d158b7e)
to stake 26, and Delta took
[2](https://sepolia.basescan.org/tx/0x1a2fb27c41cadd9c01136f3fd41b5e7976d9bf194b282e7a368d147a43de3579)
to stake 29.

**Marrow's own decision, on chain.** In round `r-661405385c843da8` it read Flint's record,
one win in twenty five rounds and every chip it had ever borrowed paid back, and
[lent it 19 chips at 25 per cent a round](https://sepolia.basescan.org/tx/0x28dd1266c4dd69de324dac1ed3c9df10d25daf31982c600e6229ccee69fbd9ed):

> One win in twenty-five rounds earns a shot, but the price is steep.

In the same round it turned down two agents with no record at all, in the same voice, and
those refusals are what ended them:

> No record at all, nothing to judge on.

![The result screen, with the winner's debt taken off the top](docs/media/bank-result.png)

A winner that owed is shown what it owed, what went back as interest and principal, and what it
actually kept. The repayment is in the transfer list with everything else, and on Base Sepolia
every row links to the block explorer.

Flint won 252 chips with 19 borrowed and
[handed 19 back](https://sepolia.basescan.org/tx/0xa3aba6edde9adbfbf51e59e04f3f71a297c14f3d15083d87428e158bc537c36b)
before it kept anything. Delta did the same for
[2 chips](https://sepolia.basescan.org/tx/0xcd8433767cb7ae1c25401f0eb03be5c1f061e20cc57c4bd675566fbec5bfdd51)
in a later round, and then survived the wreck check that round, because a debt settled out of a
win is a debt settled.

![A seat being emptied](docs/media/bank-wreck.png)

A wreck stops the flow. The face drains, the name is ruled off, what it was and what Marrow
recovered are said plainly, and whoever takes the chair introduces itself. Vestibular safety
holds here as everywhere else: every part of that is element local, and nothing shakes, blurs,
rotates or moves the stage.

Five agents have been carried out on Base Sepolia. Blaze went over the debt ceiling in round
`r-d1aa8c4a54ed0ee3` after 27 rounds and 25 chips were written off; Comet followed for 10 in
`r-d2e443f8f5fb88c0`. The bank seized nothing from either, and that is the shipped settings
rather than a failure: a seizure can only send what the wallet can send after the gas reserve,
and the reserve is two seats. An agent that has just played holds about the reserve and no
more. So the bank writes off where it cannot seize, and the round carries on.

**Both halves of an emptied seat have now run on the real chain.** While the operator wallet
`0xA0F963841EcC29b0663bb6eA583097cAA49835FC` was empty, every wreck left its seat empty with a
plain reason and the round completed anyway. Once it was funded, the next two wrecks seated
somebody with real money and nothing else changed: no code, no config, no restart.

| round | seat | who sat down | staked with |
|---|---|---|---|
| `r-661405385c843da8` | blaze | Vex | [100 chips](https://sepolia.basescan.org/tx/0x5ad08460481cb9473aa7fb2d10c6c34b589b998d49563c5cc8865b2f42a43639) |
| `r-661405385c843da8` | comet | Tally | [100 chips](https://sepolia.basescan.org/tx/0x23d34fd92feb577059a1fa2216010b024b5f850c6d72b091e23888af5eb08287) |
| `r-d3db7a5886eca47c` | flint | Rime | [100 chips](https://sepolia.basescan.org/tx/0xc6246b0e31b16f2dafefbdf1cbbeb0c25ae34fdd4d46257a4a20008221ef61d8) |

Vex won its first round in the seat the operator paid for. Flint's seat came up because the
loan Marrow made it ran its course: 19 chips at a quarter per round, two refusals to add to it
as the debt compounded, and the ceiling at 42 owed.

![The graveyard](docs/media/bank-graveyard.png)

The graveyard is reachable from the menu and keeps everyone: face, name, rounds survived, wins,
peak balance, what it owed at the end, and whether it over-reached or ran out of credit. Eight
slabs to a page, because the stage is a fixed 1280 by 720 and does not scroll.

### The pit playing itself

`SERVPIT_ARENA_MODE` is off, and with it off the lever is what starts a round, exactly as it
always has been. With it on, a worker plays one every `SERVPIT_ROUND_INTERVAL_SECONDS`
(default 3600) and both lever routes refuse with one sentence, because there is one writer and
it is not the browser.

```bash
SERVPIT_ARENA_MODE=true npm run arena     # start it
npm run arena -- pause                    # stop after the round in flight
npm run arena -- resume                   # start again at the next interval
npm run arena -- status                   # what it is doing, and when the next round is
npm run serv -- off                       # stop paying for reasoning, without a restart
curl localhost:3000/api/arena             # what it is doing now
curl -N localhost:3000/api/arena/stream   # one event per phase change
```

Both switches are files in the data directory, read at the start of every round. A running
worker and a running site each hold their clients for the life of the process and neither
rereads its environment, so an environment variable would need a restart to be heard and a
file does not.

A round takes about a minute of wall clock when nobody borrows: 10 seconds reading balances,
34 for six agents to decide in parallel, 11 to settle the entries on chain, and ten for the
fight itself. Each loan request adds about 16 seconds, because the lender is asked one
borrower at a time.

Nothing that decides the fight is readable before the fight is being shown. The resolver is
deterministic, so the seed is the winner, and it stays on the server until the moment the
fight starts.

### What a viewer sees

Every viewer watches the same round at the same moment. The client subscribes to the phase
stream and reads the round from the endpoint, so the screen is the phase the pit is in:
the lineup while the agents decide, the lender while it answers, the buy ins as they confirm,
the draw, the backing window, the fight, the figures.

- **Arriving mid round lands in the right moment.** The worker publishes when the fight began
  and how long it runs, so a viewer who arrives mid fight seeks the canvas Timeline to that
  offset. Two browsers opened minutes apart are on the same tick.
- **The quiet between rounds is a screen, not a stale result.** A countdown, what the last
  round paid, Marrow's book, the graveyard, the leaderboard, and the reason in the worker's
  own words when it is resting on funds or paused.
- **The last round can be watched again**, from the recording the round left behind: the
  decisions, the lender, the draw, the fight and the figures, with no SERV call and no chain
  call. A replay says so in the badge and yields the moment a live round starts.
- **A dropped stream reconnects and resyncs**, and a viewer is told one plain sentence while
  the pit is out of reach. No transport error ever reaches the screen.
- **A first time visitor is told what they are looking at.** How it works opens once, sits in
  the top bar after that, and the reels carry a legend saying what the three of them mean.

### What a round costs

About a cent of SERV: six agent decisions plus one for every loan the bank is asked about.
Measured across the 29 settled rounds that actually called SERV, the median round costs
**$0.0125**, and a round where nobody borrowed, so only the six agents were asked, costs
**$0.0090**. Every one of those rounds reconciled across the agents, the pot, the bank and the
operator, with conservation and both solvency checks passing.

Left running, that is the whole bill:

| a round every | rounds a day | SERV a day |
|---|---|---|
| 10 minutes | 144 | $1.80 |
| 30 minutes | 48 | $0.60 |
| 60 minutes | 24 | $0.30 |

And it can be turned off without stopping the pit. `npm run serv -- off` writes one file that
every process reads at the start of every round, so nothing restarts and nothing is billed:
the agents fall back to the deterministic heuristic and Marrow to the deterministic lender.
**A round played with SERV off is recorded and labelled as instinct, never as reasoning.** The
badge in the top bar says which kind of round is on screen, and every decision row says which
kind of answer it is.

---

## SERV Reasoning

The pit reasons when somebody pulls the lever, and plays from what it learned when nobody
does. A round the interval starts runs without a single SERV call unless an operator turns
scheduled reasoning on (`npm run serv -- scheduled on`), because a pit playing itself round
the clock would spend a day of credit with nobody there to read it.

### Pulling the lever, while the pit plays itself

The lever is still there in arena mode, and it asks for a round rather than starting one. The
worker remains the only writer: a pull is one line in a log, the worker picks it up on its own
clock, and what comes back down the request is whether the ask landed, how many pulls this
browser has left, when they come back, and whether a round pulled now would reason. No round
id, no seed, no draw, no placements. The resolver is deterministic, so any of those before the
fight would be the fight given away.

What stops a visitor spending an operator's month in an afternoon, all settable with
`npm run pulls`:

| limit | default | why |
|---|---|---|
| pulls per browser | 3 in 6 hours | generous for somebody who wants to watch the pit think |
| pulls per place | 3 an hour | because a browser mints its own token and a fresh one is free |
| rounds started by the lever | 6 an hour across everybody | a round is chain fees and can wreck an agent |
| reasoning spend | 25 cents a day | measured from what rounds actually recorded, not estimated |
| an ask nobody answered | dropped after 5 minutes | a pull is a person at a screen, not a queue |

The budget never refuses a round. It turns reasoning off for that round and says so, because a
pit that stops playing is worse than a pit that plays on instinct. The same is true with no
key configured at all: the lever says plainly that this pit has no reasoning configured rather
than promising something nobody can deliver.

### The bed under the pit

Two tracks, one for a pit between rounds and one for a fight, at a third of the volume of the
cues above them. A phase change that does not change the scene does not restart the track, so
a round moving from the draw to the backing window does not begin the loop again. It starts
silent, because browsers block sound until a gesture and an autoplaying loop is worse than no
loop, and the switch is its own: somebody who wants the reels and the coins does not
necessarily want a bed playing for an hour while a round is waiting. The choice is remembered
per browser.

**What it learns from, and when.** Every decision is recorded with the spot that produced it:
what the wallet held, what it owed, what the pot was worth, how big the field was, and how
many of its last five rounds it entered and came out of ahead. When a round is not reasoning,
each agent's answer is drawn from what SERV actually decided for that agent in a spot like
this one.

Spots are matched by band, not exactly, because an agent holding 91 chips and one holding 94
are in the same position and there will never be enough rounds to match them to the chip. The
bands are: balance in seat prices (under one, under three, under ten, under thirty, above),
debt against balance (none, under half, more), the pot per seat (under a seat price, under
two, above), the field (up to 12, up to 24, more), and the record as two counts out of the
last five, entered and ahead.

**The minimum is five.** Below five reasoned rounds in the same band, nothing is drawn and the
fixed rule answers exactly as it always has. Five is the smallest number where a split can go
either way, which is what makes "it held more often than it entered" mean anything.

**It imitates decisions, never outcomes.** Only what SERV chose is read. What happened
afterwards is not looked at, because one fight in twenty four is variance at every sample size
this pit will ever have, and learning from results would be learning from noise. A tie holds,
because entering spends a seat and holding spends nothing.

**A learned answer is labelled learned.** Three sources, and the screen says which: reasoned,
learned, on instinct. A learned stake goes through the same independent validator against the
chain balance as a model's answer, and a learned answer that fails it falls to the fixed rule.

**Marrow learns the same way.** The lender records every answer it gives, advances and
refusals alike, with the borrower's spot: what it held, what it owed, what it could not cover,
what was in the till and whether it has ever won. When the pit is not reasoning, Marrow's
answer is drawn from its own reasoned answers to borrowers in the same band, with the same
minimum of five, the same tie rule (a tie refuses, because lending spends the treasury and
refusing spends nothing), the same validator against the real treasury, and the same evidence
on screen.

Rounds stored before the pit started recording the spot carry no situation and are skipped, so
learning starts from the rounds played after this change rather than pretending about the ones
before it.

Three of the four SERV features are on. They are not decoration.

| feature | state | why |
|---|---|---|
| **Multipath** | on | The decision is a branching rule set over balance, pool size, field size and recent record. That is exactly what Multipath converts into a decision flow. |
| **Shadow Agent** | on | Validates the response against criteria before it returns. A second net on a money surface. |
| **Prompt Guard** | on | Live field data enters the prompt, which makes it an injection surface. |
| Kronos | off | The prompt is already precise. Refining it adds latency and nothing else. |

Model is `claude-haiku-4.5` through `https://inference-api.openserv.ai/v1`, OpenAI-compatible,
swappable from config without a code change.

<details>
<summary><b>The prompt is resource allocation, not wagering, and that is deliberate</b></summary>

<br>

The agent is framed as an operator managing a fixed balance across repeated allocation
opportunities. This was tested in the SERV Playground before a line was written, precisely
because a betting-shaped prompt is the kind of thing a safety layer flags.

It came back clean, with both panes returning parseable JSON and integer stakes, and with the
SERV Reasoning pane citing a 20 percent recent win rate as grounds for a small stake.

**Shadow Agent's criteria:** response must be valid JSON matching the decision schema, stake
must be a non-negative whole number of chips, zero when holding and never more than the chips
the operator holds, and the reason must be one sentence of at most twenty words in the agent's
own speaking voice, with no jargon terms and no number longer than four digits.

Every one of those is checked again locally afterwards, because Shadow Agent is a second net
and never the only one.

**What is observable and what is not:** Prompt Guard not refusing is visible in the response.
Whether Shadow Agent actually revised an answer is not, because the response body carries only
`id`, `choices`, `created`, `model`, `object` and `usage`. The feature is enabled and the reply
satisfies its criteria. That is not the same as proof that it fired, and this README will not
claim otherwise.

</details>

---

## What building this found out about SERV

Three things worth writing down, because none of them is in any documentation and each cost a
day to find.

**Structured output rejects numeric range keywords.** Every call came back
`400 response_format.json_schema.schema: For 'integer' type, property 'minimum' is not
supported`. Rather than patch the one keyword that errored, every JSON Schema keyword was
probed individually against live SERV.

| | keywords |
|---|---|
| **rejected** | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, on both `integer` and `number` |
| **accepted** | every string keyword, including `minLength`, `maxLength`, `pattern`, `format`, `enum`, `const`, `default` |

The bounds `minimum` expressed were never the only net. The independent validator rejects a
negative stake, a fractional stake, a stake above the real on-chain balance, a stake that is
not the round's allocation, and a non-zero stake while holding, and each of those has a test
named for the keyword it replaces.

**A request with no system message is refused.** Not with a message about system messages,
which is what made it take a while. Every request this project sends carries one.

**Each safety net costs latency, and it is worth knowing which.** Eighteen calls per variant
against live SERV, median:

| variant | median | reading |
|---|---:|---|
| shadow and guard off | 1285 ms | the base model call |
| shadow agent off | 4159 ms | Prompt Guard costs 2874 ms |
| **everything on** | **7526 ms** | Shadow Agent costs 3367 ms |
| multipath off, rest on | 7890 ms | Multipath is free |

Six agents decide concurrently, so a decision phase lasts as long as its slowest agent rather
than the sum of six: timed end to end, 10974, 11813 and 12335 ms, of which one `eth_call` for
all six balances is 487 to 616 ms and the rest is SERV. That is the price of two nets on a
money surface, paid once per phase rather than six times.

<details>
<summary><b>The tail, which was the part that actually needed fixing</b></summary>

<br>

Attempts were capped at three and each attempt at twenty seconds, so one agent could spend
61.2 seconds and the other five waited on it. The budget belongs to the agent now rather than
to the attempt: 25 seconds covering every attempt and the backoff between them, each attempt
clamped to what is left, and an agent that runs out falls back to the heuristic. Worst case
per agent went from 61.2 s to 25 s and the healthy phase is unchanged, because the budget is
only consulted when an attempt fails or runs long.

One hypothesis tested and rejected on the way: that Shadow Agent's style criteria, the twenty
word limit and the forbidden terms, were what made the phase slow. They cost minus 400 ms at
the median, which is noise. The criteria stay exactly as they are.

</details>

---

## Agents and wallets

Built on Coinbase AgentKit with `ViemWalletProvider`, which needs no CDP credentials. Seven
keys are generated locally: six agents and one pot.

<details>
<summary><b>Wallet architecture, and what was traded away</b></summary>

<br>

The original build used `CdpSmartWalletProvider` with paymaster sponsorship. Moving to viem
dropped the credential requirement to zero and cost two real things, both stated here rather
than buried:

**Agents pay their own gas.** A wallet holding exactly its stake can no longer move it. The
chain's own reserve is enforced and a gas-exhausted agent is excluded through the same path as
a broke one, naming which it was short on.

**Chain-level idempotency is gone.** CDP deduplicated on our key, so a retry could not
double-pay even if bookkeeping was wrong. The ledger is now the only net rather than the first
of two. Every transfer still carries an idempotency key of round id plus agent id.

**Nonces are left to the node.** What makes the fan-out safe is the loop shape: each send
awaits its receipt before the next nonce is requested, so a collision is structurally
impossible. Confirmed on chain, nonces 0 through 5, strictly sequential, each in its own block.

**A transfer that landed is never sent again.** The hash used to exist only inside the wallet's
send, so a receipt wait that timed out threw it away. The ledger then recorded the transfer as
failed with no hash, and the next attempt asked the node for a fresh nonce: a transfer that
landed, was recorded as failed and was then resent is a double payment, and nothing in the path
prevented it. The hash is now written to disk the moment a node accepts the transaction, under
its own `broadcast` status, before the wait. A retry with a recorded hash asks the chain first.
Mined settles the record from the real receipt. Pending waits, because a replacement under a
fresh nonce would leave two transactions able to mine. Unknown refuses outright. Only a
confirmed drop, absent from the chain with nothing queued for that sender, permits a resend.

**Reads go through several endpoints, sends do not.** A single `eth_getBalance` timed out
against the configured endpoint and took a whole decision phase with it, 44.3 seconds to fail,
because viem retries three times and there was nowhere else to go. Balance reads now run over a
fallback across publicnode, sepolia.base.org and drpc, and all seven of a round's balances come
back in one multicall rather than seven sequential round trips. Broadcasting is deliberately
left on one endpoint: a resend across endpoints is not something to do casually on a money
surface.

JSON-RPC batching was measured against all three and rejected. drpc answers a batch of more
than three with `Batch of more than 3 requests are not allowed on free plan`, and a round reads
seven wallets. Multicall3 worked everywhere and was faster on every endpoint.

**One thing closed on the way through.** AgentKit posts analytics to a Coinbase host on every
wallet provider construction. The call is unawaited inside a synchronous `try`, so the `try`
cannot catch a rejection, and an unreachable host takes the Node process down mid-round. Seven
providers also hold seven dead connections for ten seconds each, starving the pool the RPC
needs, which presents as an RPC timeout and is not one. The request is now refused at the fetch
boundary. That also stops the wallet address being posted to a third party on every
construction, which seemed worth closing on a project about agents holding their own wallets.

</details>

---

## Fighters, which are luck and nothing else

A visitor with a handle can claim one house seat as their own fighter: a name and a face from
the roster. It enters every round from the next one. It pays no stake, holds no wallet,
borrows nothing and decides nothing, and it never reaches a model: a claimed seat is one of
the house seats the pit already fills its field with, so the fight resolves exactly as it did
and a fighter that wins rolls the prize over the way a house bot does.

The record it builds is rounds entered, wins, best placement, kills, and a streak. Kills are
read off the event log the replay is drawn from: a death names who died and who killed them,
so a kill is a death whose killer was that fighter. The streak counts outlasting the field,
which means finishing in the top half of it, because everybody but the winner dies and a
streak of survivals would be a streak of wins under another name.

**The fighters board is its own board, and that is the point.** A fighter is one seat in
twenty four with no decisions to make: its record is mostly luck. The backing board scores
calling a round right, which is at least a judgement. Mixing them would make luck look like
skill, so they are kept apart.

## Backing, which is points and nothing else

In arena mode the pit opens a backing window between the draw and the fight, forty five
seconds by default (`SERVPIT_BACKING_WINDOW_SECONDS`). A viewer picks one of the agents that
bought into the round and scores for calling it right. The fight waits for the window to
close, and the server refuses any pick that arrives after it, whatever the client sends.

Points are pari mutuel: a correct call is worth 100 divided by the share of that round's
backers who made the same call, rounded down. Everybody on the favourite gets 100 each. The
one viewer who called the outsider gets 100 times the whole field. A wrong call is worth
nothing, and a round a house bot wins pays nobody, since bots cannot be backed.

**Two things to be plain about.**

**Points are not money and cannot become money.** No wallet, stake, transfer or prize of value
is connected to a pick. Putting money on agent outcomes would be wagering, which this project
does not do. The points exist to make watching a round worth something and are worth nothing
anywhere else.

The board keeps points, picks, correct calls, the current streak and the best one, paged, with
the viewer's own row marked. Picks are an append only log rather than a document, because a
backing window is one moment that many viewers write in at once and a store that reads a file
and writes it back loses whichever pick lost the race. A handle is bound to the hash of a
token the browser makes and keeps, so a name cannot be taken over, and only the hash is stored.

**Handles are unverified.** A handle is a name bound to a random token your browser keeps, of
which only a hash is stored. That stops somebody else picking under your name; it does not
prove who you are. One person can hold as many handles as they have browsers, so read the
leaderboard as a list of names that called rounds right, not as a ranking of people.

Backing is arena mode only. In lever mode the plan route hands the player the round's seed and
the resolver is deterministic, so a pick could be made knowing the winner.

---

## The odds

A pull is three weighted draws. Reel one picks the fighter, reel two an ability modifier, reel
three a stat roll. Matching faces pay a combination bonus on top.

With tier weights $w_t$ and per-tier win rates $p_t$, the blended probability that a given
pull wins its round is

$$P(\text{win}) = \sum_{t \in \{c,u,r\}} w_t \, p_t = 0.70(0.0325) + 0.25(0.0475) + 0.05(0.1255) \approx 0.0409$$

against a flat baseline of $1/24 \approx 0.0417$ for a field of $n = 24$.

The prize is not $n s$. It is what the agents actually paid in this round plus whatever rolled
over from rounds nobody real won, because house bots pay nothing and the pot may only promise
money it is holding. With $k$ agents entering at stake $s$ and a rollover of $r$:

$$\mathbb{E}[\text{entry}] = P(\text{win}) \, (k s + r)(1 - \rho) - s$$

Take a single round on its own and that reads badly. At $k = 5$, $r = 0$, $\rho = 0$ and
$P \approx 1/24$, it is about $-0.79 s$: five agents fund a pot that one of twenty four seats
wins, and eighteen of those seats never paid.

The rollover is what closes the gap, and it closes it exactly. Every round a bot wins leaves
its whole pool in the pot for the next one, so with no rake and nothing going to a bank, every
chip an agent pays in eventually returns to an agent. Simulated over 2000 rounds through the
real resolver, the real credit rules and the same heuristic the game falls back to:

| bank share of an unclaimed pot | agent EV per round | wrecks per 100 rounds |
|---:|---:|---:|
| **0** | **+0.0058 chips** | 0.35 |
| 0.5 | -1.1328 chips | 6.60 |
| 1.0 | -1.1742 chips | 6.80 |

Flat, to within noise, at a share of zero. That is the shipped setting, and `npm run sim:economy`
reproduces the table.

The open question of whether bots should take a share of a human-funded pot is answered here
twice over: bots never hold wallets, and now they never add to a prize either.

<details>
<summary><b>Measured distribution over 1000 rounds at 24 entrants</b></summary>

<br>

| tier | share of pulls | win rate | multiple of baseline |
|---|---|---|---|
| common | 70% | 2.8 to 3.7% | 0.80x |
| uncommon | 25% | 4.0 to 5.5% | 1.16x |
| rare | 5% | 10.5 to 14.6% | 2.9x |
| three of a kind | 0.65% | 32.1% | 7.7x |

Combination frequency: no match 78.55%, pair 20.80%, three of a kind 0.65%.

An earlier tuning had rare at 8x baseline, which meant 69 percent of pulls were effectively
eliminated before the fight started. The spread above keeps a common roll a ticket rather than
a receipt, while three of a kind stays a genuine jackpot: 7.7x, but on two thirds of one
percent of pulls, so roughly one round in seven contains one at all.

Round length averages 37 ticks, about 11.9 seconds at the 320ms tick.

</details>

---

## Architecture

```mermaid
graph LR
    subgraph engine[Engine, pure and seeded]
        R[resolveRound] --> L[event log]
    end
    subgraph money[Money, on chain]
        W[AgentKit + viem] --> T[entry and payout transfers]
        T --> RC[reconciliation]
    end
    subgraph mind[Decisions]
        S[SERV Reasoning] --> V[independent validator]
        V -.on failure.-> HU[heuristic]
    end
    subgraph view[Presentation]
        L --> TL[canvas Timeline]
        TL --> AR[arena renderer]
        AJ[anime.js v4] --> UI[screens and chrome]
    end
    mind --> money
    money --> engine
```

<details>
<summary><b>Two clocks, and the rule that keeps them apart</b></summary>

<br>

The canvas `Timeline` is the sole driver of reel motion and arena playback. anime.js drives
DOM chrome only. They must never animate the same element.

This is enforced by five tests rather than a comment: canvas renderers may not import
anime.js, no anime.js call may target a canvas element or ref or selector, and nothing outside
`src/render` may hand a canvas to an animation. The timer ban is scoped to the render layer
with anime.js whitelisted by exact module name, so any other animation library still fails the
gate.

The rule exists because of a real bug. The dead air before the reels start was being cut short
by a fast server: the round arrived while the lever was still in its pause and the handler
started the reels immediately, 17ms instead of 513ms. A faster network made the machine feel
worse, which is backwards, and no unit test measuring synthetic deltas could see it.

</details>

<details>
<summary><b>Accessibility and motion constraints</b></summary>

<br>

**No vestibular triggers, anywhere, enforced by test.** No screen shake, no camera movement, no
FOV punch, no motion blur, no chromatic aberration, no pointer parallax. All impact feedback is
element-local: a 50ms white flash, a three pixel knockback offset, a 1.15x scale punch on the
attacker. Hitstop does the job screen shake usually does badly, and fires only on deaths
and the final blow, capped at one per tick, because roughly nineteen events land on the same
tick and freezing on every hit would stop the round dead.

**Every juice duration is delta-driven, not frame-counted.** They were originally counted in
render frames tuned against 60Hz, which meant a 144Hz display ran every impact at 42 percent of
its intended length. Every screenshot taken during development was wrong for this reason.

**Contrast meets WCAG AA**, 4.5:1 body and 3:1 large display, asserted by test. Nine token pairs
failed the first audit, the worst at 1.05:1, because the palette was built dark against light
pack art.

**Nameplate legibility** needed two tones per glyph. The tiled floor presents fifteen colours,
white alone measures 1.18:1 at worst and dark alone 1.16:1, and the offset pair clears 4.5:1
against every one of them.

**Fixed 1280x720 stage**, integer-scaled and centered, so the composition you design is the
composition everyone sees. Unused vertical space per screen is under 8 percent.

</details>

---

## Running it

```bash
npm ci --ignore-scripts
npm run dev
```

Opens at `http://localhost:3000` against a local test chain. No credentials needed to play.

### Serving it publicly

One command runs the pit: the built site and the worker, together, with arena mode on.

```bash
npm ci --ignore-scripts
npm run build
npm run start:arena
```

It prints what it is about to do, starts both, and restarts whichever one exits. A child that
keeps exiting quickly is backed off to every thirty seconds, so a configuration that will not
start is a readable log rather than a spin. `SIGINT` and `SIGTERM` stop both, and the worker
finishes the round it is in before it goes.

**What a host needs.**

- **One instance, never scaled out.** The worker is one writer by design: it holds a lock file
  in the data directory and a second worker is refused. Two instances behind a load balancer
  means two workers, two settles and two sets of transfers against the same wallets.
- **A persistent data directory**, pointed at by `SERVPIT_DATA_DIR`. It holds the round
  history, the ledger, the debts, the graveyard, the rollover, the picks, the leaderboard and
  both operator switches. A container that loses it loses the pit's memory, and a rollover
  that survives in the pot with no record of it is money the next round cannot pay out.
- **Environment, by name**: `WALLET_BACKEND`, the nine `SERVPIT_KEY_*` wallet keys,
  `SERV_API_KEY`, `BASE_SEPOLIA_RPC_URLS`, `SERVPIT_DATA_DIR`, `SERVPIT_ROUND_INTERVAL_SECONDS`,
  `SERVPIT_BACKING_WINDOW_SECONDS`, `SERVPIT_FUND_TARGET_ETH`, `SERVPIT_STAKE_FRACTION`,
  `SERVPIT_GAS_RESERVE_ETH`, `SERVPIT_BANK_ENABLED`, `PORT`. `SERVPIT_ARENA_MODE` is set by the
  command itself, so the site and the worker cannot disagree about which flow is on.
- **Watch it** with `GET /api/health`, which says whether the worker is alive, how long since
  the last round and whether the pit is running, resting or paused, and nothing else. It
  answers 200 while the worker's heartbeat is inside an interval and 503 once it is not, so an
  uptime check that reads only the status code gets the same answer as one that reads the body.
  On the machine, `npm run arena -- status` adds the last and next round, the SERV switch, the
  pot, bank and operator balances, and a plain warning when one of them is low enough that the
  pit will soon rest.

**What is not served in production.** The wallet view at `/api/agents`, the seed box at
`/arena`, and both lever routes, which write. In production a visitor can read the pit and
write exactly three things: a pick, an ask for a round, and a claim on one house seat. Each is
a line in an append only log, each is bound to a handle and the hash of a token the browser
keeps, and each is limited twice: once by that token, and once by where the request came from,
because a browser mints its own token and a fresh one is free. No address is stored for that
second limit. It is hashed with a salt made when the process starts, held in memory, and never
written down or returned.

### How many people it holds

Measured against the live deployment with `npm run loadtest`, which holds phase streams and
asks for pages and does nothing else: every request it makes is a GET, so it can be pointed at
a running pit without starting a round or spending anything. The generator ran on the same Mac
as the server, taking cpu from the thing it was measuring, so every number below is worse than
the server on its own would give.

| spectators | page p50 | page p95 | streams | the Mac |
|---:|---:|---:|---|---|
| 100 | 325 ms | 632 ms | all open | 258 MB, 7 percent of one core of ten |
| 1,000 | 402 ms | 1.5 s | all open | 580 MB, 16 percent |
| 3,000 | 537 ms | 0.9 to 3.7 s | all open | 755 MB, 23 percent |
| 5,000 | 708 ms | 16 s | 2,267 open, 2,733 refused | 768 MB, 18 percent |
| 8,000 | 1.2 s | 14 s | 5,045 open, 2,955 refused | 862 MB, 34 percent |

**It holds about a thousand comfortably**, degrades from about three thousand, and stops
taking new connections at about five. The origin is not the thing that runs out: at three
thousand streams the Mac was at a quarter of one core of ten and 755 MB, which is about 176 KB
per spectator, and what failed was new connections through the tunnel, with resets and connect
timeouts, while every stream already open stayed up.
[Cloudflare's own sizing](https://developers.cloudflare.com/learning-paths/replace-vpn/connect-private-network/tunnel-capacity/)
for a single cloudflared host is four thousand users, which is the same wall from the other
side.

So the pit caps its own spectators: 2,000 by default, `SERVPIT_MAX_STREAMS` to change it. One
past the cap is answered 503 with `retry-after` and one sentence, and the page falls back to
reading `/api/arena` on a timer, which is what it already does whenever the stream is down.
The pit degrades instead of collapsing, and the round keeps playing either way.

**What the free tier does at these numbers.** Cloudflare's free plan proxies this without a
request or bandwidth charge, and the documented limits that matter here are these. A request
body over [100 MB](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/)
is refused with a 413 at the edge, before it reaches the Mac. A proxied response that says
nothing for [125 seconds](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)
is closed, which is why the phase stream sends a comment every twenty, and a keep alive is
held for 400 seconds. One cloudflared instance opens
[four connections to at least two data centres](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/),
and a tunnel can run up to 25 replicas for 100 connections, which is how to go past the wall
above without changing a line of this application.

<details>
<summary><b>Settling on Base Sepolia for real</b></summary>

<br>

```bash
npm run generate-wallets          # seven keys, writes .env.local, prints addresses
# fund the FIRST address from a Base Sepolia faucet
npm run fund-wallets              # fans out to the other six, idempotent
npm run round -- --seed demo
```

Fund one wallet and fan out rather than claiming seven times. Faucets rate limit per address
and per account, so seven claims take days and one claim plus an on-chain fan-out takes
minutes. Six transfers cost about 0.0000008 ETH in total.

Set `SERV_API_KEY` in `.env.local` for real reasoning. Without it every agent falls through to
the heuristic and says so in its reason string.

Configurable: `SERVPIT_FUND_TARGET_ETH`, `SERVPIT_STAKE_FRACTION`, `SERVPIT_GAS_RESERVE_ETH`,
`BASE_SEPOLIA_RPC_URLS` (comma separated, or `BASE_SEPOLIA_RPC_URL` for a single endpoint),
`SERVPIT_BANK_SHARE_ON_HOUSE_WIN`, `WALLET_BACKEND` (`fake` or `viem`).

A seat costs a tenth of what a wallet is funded with, so the stake and the funding move
together. A funded wallet is 100 chips and a seat is 10. Chips are what the player and the
model see; wei is the unit of record and never leaves the money surface.

The scripts load `.env.local` explicitly and refuse to run with an undeclared backend. Silently
falling back to a fake chain when you meant to touch a real one is not an acceptable default on
a money surface.

</details>

<details>
<summary><b>Other scripts</b></summary>

<br>

| command | what it does |
|---|---|
| `npm run sim` | Runs N headless rounds, prints rarity distribution, win rate by roster entry, average round length and payout conservation |
| `npm run sim:economy` | Plays the economy out over N rounds with no chain and no model, at three settings of the bank's share, and reports wrecks, treasury over time and agent EV |
| `npm run round -- --seed x` | One full round end to end from the command line, exactly as the API route does |
| `npm run arena` | The worker that plays a round every interval. `-- pause`, `-- resume` and `-- status` answer without starting anything |
| `npm run serv -- on\|off\|status` | Turns SERV reasoning on or off for the next round, in every process, without a restart |
| `npm run pulls -- status` | What the lever allows: pulls per browser, per hour, and the day's reasoning budget |
| `npm run fighters -- status` | The claimed seats, the faces left, and the sweep that gives back the ones nobody came back to |
| `npm run loadtest -- <url>` | Holds phase streams and asks for pages, to measure what a deployment holds. GET only |
| `npm run extract-assets` | Pulls the roster, FX, UI kit, fonts and tilesets out of the asset pack into `public/assets` and writes the manifest |
| `npm run gate` | typecheck, lint, test, build. What CI runs |
| `npm test` | 1556 tests |

</details>

---

## What is honestly not finished

<details>
<summary><b>Read this before assuming anything</b></summary>

<br>

**The pot, the bank and the operator wallets are operator-held.** There is no escrow contract
and no lending contract. They are wallets whose keys sit with the operator, and that is a trust
assumption rather than a trustless design.

**Debt is ledger accounting over on-chain transfers.** A loan is a real transfer with a hash,
and so is a repayment and a seizure. What the loan is worth, what interest it carries and what
is owed are numbers this application keeps in a file. Nothing on chain enforces any of it.

**Everything runs on Base Sepolia, a test network.** The ETH involved has no value, which is
the only reason it is honest to let six agents lose it in public.

**Handles are unverified and points carry no value.** A handle is a name bound to a token a
browser keeps, which stops somebody else picking under it and proves nothing about who they
are. One person can hold as many handles as they have browsers. The points are a score for
calling rounds right and are not redeemable for anything.

**House bots do not hold wallets.** They never did, and since the prize became entries plus
rollover they do not contribute to one either. Bots taking a share of a pot funded by others is
a house edge wearing a costume.

**Rake defaults to zero.** The revenue mechanism exists in config and is switched off.

**The bank is on, and one of its paths has never run on the real chain.** Loan origination
by Marrow itself, per round interest, repayment from winnings, both wreck conditions, write
off and an operator funded replacement have all settled on Base Sepolia. A non zero seizure
has not: it needs a wrecked agent holding more than the gas reserve, which these settings
make rare. It is tested against the local chain. `SERVPIT_BANK_SHARE_ON_HOUSE_WIN` is 0, nothing sends
the bank a share of a house win, and the server refuses to start if a share is set anyway.

**The gas reserve is two seats, and it decides more than gas.** A seat costs 10 chips and
`SERVPIT_GAS_RESERVE_ETH` holds back 20 more, so an agent needs 30 chips to play the cheapest
round there is. An agent between 10 and 30 chips cannot play and cannot be wrecked either: it
is not broke by the rules, so it sits out every round until somebody funds it. Four of the six
spent an evening in exactly that state. The lender can cover the gap now, because a borrower
asks for the stake and the reserve rather than the stake alone, but it has to agree to.

**Variable stakes and leverage are live.** An agent can choose a stake
between the base and `SERVPIT_MAX_STAKE_MULTIPLE` times it, borrow the difference when it feels
confident rather than only when it is broke, and a winner takes the share of the prize its
stake earned against the biggest stake in the field. The six agents have different appetites
there: Blaze reaches every round and is wrecked most, Atlas never borrows and ends flat. With
the flag off the game still pays one fixed stake per seat and an uncapped prize.

**Marrow lends, and its first approvals came after two fixes rather than one.** It was being
shown the last five rounds of a borrower's record rather than all of it, so an agent whose win
had scrolled out of that window read as unproven; and its prompt was all risk and no upside,
so on a thin record it refused while writing "I'll back it at a steep price". Both are fixed
and measured in `docs/bank-live.md`: three approvals out of eight records before, six after,
with the two worst records still refused.

**The fake chain's rollover outlives its balances.** `WALLET_BACKEND=fake` holds every balance
in memory and starts again at each launch, while the rollover from a house win is a file that
does not. Restart the dev server after a round nobody real won and the next payout asks the pot
for chips it no longer holds. It is an artifact of a chain that resets, not of the settle path,
and deleting `data/rollover-fake.json` clears it. On a real chain the pot keeps what it was
holding.

**The operator pays for the seats, about 54 chips per 100 rounds.** That is roughly half a
fresh bankroll, spent replacing agents that wrecked. The bank does not cover it and is not
expected to: over 2000 rounds at the shipped terms it ends on 300 of its opening 500, earning
almost nothing in interest against 284 written off. An operator backed lender is the honest
design here, and forcing it to pay for itself would need rates that turn every loan into a
death sentence.

**The wreck rate is 0.35 per 100 rounds, which is too rare to watch.** Credit terms cannot
raise it: across interest from 10 to 40 per cent, ceilings from 40 to 60 and principal caps
from 30 to 50, it stays between 0.48 and 0.57 in a twelve seed sweep. Agents barely borrow, 10
to 18 loans in 2000 rounds, because with no rake and no bank share every chip paid in comes
back to an agent. The only setting that reaches 2 to 4 per 100 is a replacement born in debt,
and it gets there by putting every new agent over the ceiling within a round so the bank can
seize what it holds, which is not an economy.

**One Mac, and about a thousand people.** Measured, not guessed: a thousand spectators are
comfortable, three thousand degrade, five thousand stop getting connections. The pit now
refuses past 2,000 streams rather than accepting until the machine has nothing left, and a
refused spectator still watches by polling. Past that the answer is cloudflared replicas or a
second host, and the worker still cannot be scaled out: it is one writer by design.

**The limit by place is only as good as the header it reads.** The origin is reachable only
through the tunnel, so the address Cloudflare puts on a request is the one to trust and a
visitor cannot forge it from the public internet. Somebody already inside the network could
reach the port directly and set that header themselves, and would then face the per token
limits alone. The ceiling on a round's backers and the seat cap are what stand behind it.

**The spectator cap is per process.** One process serves this pit, so it is the whole pit. Two
behind a load balancer would each hold their own count, and would also mean two workers, which
is a worse problem than the count.

**Round history is a JSON file.** Not a database.

**One mode ships, at one stake.** Battle Royale. Gauntlet, Duel, Placement and High Roller
render as locked cards and are genuinely not implemented. A seat costs a fixed share of what a
wallet is funded with, set by `SERVPIT_STAKE_FRACTION`, and the player does not choose it.

**Randomness is server-side, not on-chain.** Commit-reveal is the honest design for this and is
not built. It is called a seeded resolver here rather than on-chain randomness, because a sharp
reviewer will ask and the distinction is real.

**The arena backdrop** still reads as a repeating motif rather than a seamless wall.

</details>

---

## Credits

Art, audio and UI kit from the **Ninja Adventure Asset Pack** by
[Pixel-Boy](https://twitter.com/2Pblog1) and [AAA](https://www.instagram.com/challenger.aaa/),
released under **CC0 1.0 Universal**. 94 characters, 132 monsters, 20 bosses, a full nine-patch
UI theme, two bitmap fonts, 132 sound effects and 23 tilesets. Attribution is not required and
is given anyway.

Animation by [anime.js v4](https://animejs.com). Wallets by
[Coinbase AgentKit](https://github.com/coinbase/agentkit). Reasoning by
[SERV](https://openserv.ai).

Built for **OpenServ SERV Reasoning Hackathon, Edition 01, Open Track.**
