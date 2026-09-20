// What the arena HUD reads while the replay is playing.
//
// The HUD used to show placements.length, which is the final placement list
// and therefore the entrant count. It never changed: the count read 24 with
// twelve entrants already listed as out in the feed beside it.
//
// The live figure comes from the timeline's own actor state, which is the
// same clock the canvas draws from. Nothing here starts a second clock; the
// HUD reads the tick that has already been applied.

export interface ArenaActor {
  id: string;
  alive: boolean;
  /** Tick the actor died on. The timeline reports null while it stands. */
  diedAtTick?: number | null;
}

export interface ArenaStanding {
  standing: number;
  /** Ids that are out, most recent first. */
  downed: string[];
}

export function arenaStanding(actors: readonly ArenaActor[]): ArenaStanding {
  const downed = actors
    .filter((a) => !a.alive)
    // A death with no recorded tick sorts last rather than being dropped.
    .sort((a, b) => (b.diedAtTick ?? -1) - (a.diedAtTick ?? -1))
    .map((a) => a.id);
  return { standing: actors.length - downed.length, downed };
}
