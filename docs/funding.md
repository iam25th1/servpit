# Funding the pit, and getting it out of a hold

A round spends from three wallets. The pot pays the winner. The bank, Marrow, lends an agent
that is short of a seat. The operator refills a seat whose agent was retired. Before every
round the worker reads all three, and if any of them is under what a round may ask of it,
the pit holds: it plays nothing, retires nobody, replaces nobody and writes nothing to the
graveyard. It looks again every `SERVPIT_FUNDS_CHECK_SECONDS` (600, ten minutes, by default)
and starts again on its own the first time the money is there.

While it holds, the site says **Pit paused: out of funds** over the last round that finished,
and `/api/status` says what each wallet holds and what to send.

## What each wallet needs

A chip is `SERVPIT_FUND_TARGET_ETH / 100`, which is 10^12 wei (0.000001 ETH) with the default
target of 0.0001 ETH. With the defaults, a 10 chip seat and a 20 chip gas reserve:

| wallet | the least a round needs | why |
|---|---|---|
| bank | 50 chips, 0.00005 ETH | the largest loan it may make (3 seats) and the fee to send it |
| operator | 120 chips, 0.00012 ETH | one whole refill (100 chips) and the fee to send it |
| pot | the prize it carries plus 20 chips | a payout and the fee to send it |

Those are floors, not a float. At the floor the pit plays one round and may hold again. A
sensible top up on Base Sepolia:

| wallet | send | lasts for |
|---|---|---|
| bank | 0.001 ETH (1000 chips) | about a hundred loans of a seat |
| operator | 0.002 ETH (2000 chips) | about nineteen retirements, refilled in full |

The pit also holds when it has retired `SERVPIT_RETIREMENTS_PER_HOUR` agents (12 by default)
in the last hour. That is not money and needs nothing sent: it lifts itself once the hour
has room. If it keeps happening, something is wrong with the economy, not the wallets.

## The addresses

They are public and are in the wallet registry on the machine that runs the pit:

```sh
cd ~/servpit
node -e 'const w=require("./data/wallets-base-sepolia.json").wallets; for (const id of ["bank","operator","pot"]) console.log(id, w[id]?.address)'
```

On the live pit these are the same addresses `docs/bank-live.md` lists:

- bank `0xfBeC0422C685cAE12d89c59E1aA4Fce4dD38bb67`
- operator `0xA0F963841EcC29b0663bb6eA583097cAA49835FC`

Check them against the registry before sending anything.

## Sending

Base Sepolia test ETH only. Send from a Base Sepolia faucet or from any wallet that holds
Base Sepolia ETH, to the addresses above, on chain id 84532. Nothing in the pit needs a key
to receive, and nothing here asks for one.

To see what is needed first, and again after:

```sh
cd ~/servpit
npm run arena -- status
```

It prints each wallet, what a round needs it to hold, and for any that are short, exactly how
much to send, in chips and in ETH. The figures come from the same functions the worker holds
on, so the two cannot disagree.

## Confirming it resumed

Within one check interval of the money landing (ten minutes by default):

1. `/api/status` answers `"pit": "running"` or `"resting"`, `"pausedFor": null`, and every
   wallet under `funds` with `"ok": true` and `"toResumeEth": "0"`.

   ```sh
   curl -s http://servpit.test:7080/api/status
   ```

2. The log has one `arena resumed` line, and after it `arena treasury` and then a round:

   ```sh
   pier logs servpit 200 | grep -E '"arena (paused|resumed)|arena round complete'
   ```

   A held pit logs `arena paused: out of funds` once, when it starts holding, and nothing
   more until it resumes. Many paused lines means it is being restarted, not that it is
   checking.

3. The site drops the paused notice and the next round starts.

`/api/health` keeps answering 200 the whole time the pit holds, with `"pit": "paused"` and
`"pausedFor": "funds"`, so an uptime check and Pier do not treat a pit waiting for money as
a dead one.
