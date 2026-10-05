// Takes one recorded round out of a store, for the trailer to replay.
//
// Read only. The only calls that touch the data directory are readFileSync:
// nothing here opens a store class, takes a lock or writes a byte there. The
// one file written is docs/trailer/round.json.
//
// A round's fight is not kept past the round on screen, but its seed and its
// entrants are, and the resolver is deterministic, so the fight is the seed.
// This resolves it again with the game's own resolver and refuses to write
// anything unless the winner it gets is the winner the store recorded. When
// the store still holds the fight log for that round, the two logs have to
// match event for event as well.
//
//   npx tsx docs/trailer/extract.ts <data dir> <network> <round id>
//
// It keeps what the trailer shows and nothing else: no addresses, no hashes,
// no balances. The Base Sepolia hashes on screen are in cut.ts, each with the
// live round it belongs to.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROUND } from "@/config/round";
import { resolveRound } from "@/engine/resolveRound";

interface StoredAgent {
  agentId: string;
  name: string;
  entered: boolean;
  stake: number;
  reason: string;
  source: string;
}
interface StoredRound {
  roundId: string;
  seed: string;
  createdAt: string;
  network: string;
  entrants: number;
  winner: string;
  potWei: string;
  agents: StoredAgent[];
}

const [dataDir, network, roundId] = process.argv.slice(2);
if (!dataDir || !network || !roundId) throw new Error("usage: npx tsx docs/trailer/extract.ts <data dir> <network> <round id>");
if (!/^[a-z0-9-]+$/.test(network) || !/^r-[0-9a-f]{16}$/.test(roundId)) throw new Error("network or round id is not in the expected shape");

const readJson = (file: string): unknown => JSON.parse(readFileSync(join(dataDir, file), "utf8"));
const rounds = (readJson(`rounds-${network}.json`) as { rounds: StoredRound[] }).rounds;
const round = rounds.find((r) => r.roundId === roundId);
if (!round) throw new Error(`round ${roundId} is not in rounds-${network}.json`);

// The entrant list exactly as the plan built it: the agents that entered, in
// profile order, then the house bots numbered from zero. This store's rounds
// had no claimed fighters; a round that did would need them between the two.
const entering = round.agents.filter((a) => a.entered).map((a) => ({ id: `agent-${a.agentId}` }));
const bots = Array.from({ length: round.entrants - entering.length }, (_, i) => ({ id: `bot-${String(i).padStart(2, "0")}` }));
const stakeChips = Math.max(...round.agents.filter((a) => a.entered).map((a) => a.stake));
const result = resolveRound(round.seed, [...entering, ...bots], { ...DEFAULT_ROUND, stakeTiers: { ...DEFAULT_ROUND.stakeTiers, [DEFAULT_ROUND.stakeTier]: stakeChips } });

if (result.placements[0] !== round.winner) throw new Error(`replay gives ${result.placements[0]}, the store recorded ${round.winner}; not writing`);
let checkedAgainstLog = false;
try {
  const arena = readJson(`arena-${network}.json`) as { last?: { roundId: string; fight?: { log: unknown } } };
  if (arena.last?.roundId === roundId && arena.last.fight) {
    if (JSON.stringify(arena.last.fight.log) !== JSON.stringify(result.log)) throw new Error("replayed log differs from the stored log; not writing");
    checkedAgainstLog = true;
  }
} catch (e) {
  if (e instanceof Error && e.message.includes("not writing")) throw e;
}

const names: Record<string, string> = {};
for (const a of round.agents) names[`agent-${a.agentId}`] = a.name;
const WEI_PER_CHIP = 10n ** 12n;

const out = {
  roundId: round.roundId,
  seed: round.seed,
  network: round.network,
  playedAt: round.createdAt,
  entrants: round.entrants,
  winner: round.winner,
  potChips: Number(BigInt(round.potWei) / WEI_PER_CHIP),
  checkedAgainstLog,
  names,
  decisions: round.agents.map((a) => ({ agentId: a.agentId, name: a.name, entered: a.entered, reason: a.reason, source: a.source })),
  characters: result.characters,
  placements: result.placements,
  reels: result.reels.map((p, i) => ({ entrantId: [...entering, ...bots][i].id, symbols: p.symbols, characterId: p.characterId, tier: p.characterTier })),
  log: result.log,
};
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "round.json"), JSON.stringify(out) + "\n");
console.log(`round.json: ${round.roundId}, winner ${round.winner}, ${result.log.length} events, ${result.log.at(-1)?.t} ticks, checked against stored log: ${checkedAgainstLog}`);
