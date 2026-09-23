// Adding a finished round to the fighters' records.
//
// Called by the worker after the result is published, beside the backing
// settle and for the same reason: the figures a viewer reads and the record
// they land in come from the same finished round. Nothing here can move
// money. The inputs are placements and an event log; the output is a file of
// counts.

import { log } from "../log";
import { roundsFor } from "./career";
import { CareerStore, careerFile } from "./careerStore";

export interface FighterSettleInput {
  dataDir: string;
  network: string;
  roundId: string;
  /** The claimed seats that were in this round. */
  fighters: ReadonlyArray<{ handle: string; name: string; face: string; entrantId: string }>;
  placements: readonly string[];
  log: ReadonlyArray<{ type: string; actor: string; target: string | null }>;
}

export function settleFighters(input: FighterSettleInput): { counted: number; applied: boolean } {
  const rows = roundsFor(input.fighters, { placements: input.placements, log: input.log });
  if (rows.length === 0) return { counted: 0, applied: false };
  const named = new Map(input.fighters.map((f) => [f.handle, { name: f.name, face: f.face }]));
  const applied = new CareerStore(careerFile(input.dataDir, input.network), input.network).apply(input.roundId, rows, named);
  return { counted: rows.length, applied };
}

/** The worker's call: a record must never be what makes a round fail. */
export function settleFightersQuietly(input: FighterSettleInput): void {
  try {
    const settled = settleFighters(input);
    if (settled.counted > 0) {
      log.info("fighters settled", { roundId: input.roundId, fighters: settled.counted, applied: settled.applied });
    }
  } catch (e) {
    // The round is over and its money is settled. A record that missed a
    // round is a record that missed a round.
    log.error("fighter settle failed", { roundId: input.roundId, reason: e instanceof Error ? e.message : String(e) });
  }
}
