// What the badge in the header says, and how it should look saying it.
//
// The badge used to report the stream: connected meant "watching live". But
// the stream stays connected while the pit is paused and while it rests
// between rounds, so a stopped pit sat under a badge claiming a round was
// running. On a surface where the numbers are real wallets, that is a claim
// worth getting right, so the badge now reports the pit and only falls back
// to the stream when the stream is the problem.

/** What the badge needs to know, which is a slice of the watching feed. */
export interface BadgeState {
  /** True while the phase stream is connected. */
  live: boolean;
  /** A plain sentence when the pit cannot be reached, or null. */
  error: string | null;
  /** True between rounds. */
  resting: boolean;
  /** True while an operator has stopped the pit. */
  paused: boolean;
  /** True while what is on screen is a recording rather than the pit. */
  replay: boolean;
}

/** How the badge reads: the tone picks the colour it is said in. */
export type BadgeTone = "live" | "waiting" | "replay" | "offair";

export interface Badge {
  text: string;
  tone: BadgeTone;
}

/**
 * The badge, in the order of what a viewer most needs to know.
 *
 * A replay outranks everything: a recording on screen under a badge that
 * reads watching live would be a lie whatever the pit is doing. Then the
 * stream, because if it is down nothing else the badge could say is known to
 * be current. Then the pit itself: paused, resting, or running.
 */
export function liveBadge(watching: BadgeState): Badge {
  if (watching.replay) return { text: "replay of a finished round", tone: "replay" };
  if (watching.error) return { text: watching.error, tone: "offair" };
  if (!watching.live) return { text: "reconnecting", tone: "offair" };
  if (watching.paused) return { text: "the pit is paused", tone: "waiting" };
  if (watching.resting) return { text: "between rounds", tone: "waiting" };
  return { text: "watching live", tone: "live" };
}
