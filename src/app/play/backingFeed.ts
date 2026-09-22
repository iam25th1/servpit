"use client";

// The viewer's side of the backing window.
//
// Counts change while nothing else about the round does, so this is the one
// thing the phase stream cannot carry: it fires when a phase changes, and a
// hundred viewers backing during one phase is no phase change at all. So the
// tallies are polled, and only while they can move.
//
// This file and arenaClock.ts and arenaFeed.ts are the only places in the play
// screen allowed a timer, which the guard in src/render/timeline.test.ts names
// and explains. A poll is wall time, not animation: nothing on a canvas is
// driven from here.

import { useCallback, useEffect, useState } from "react";

/**
 * The slice of the backing endpoint this file reads. Mirrors it, rather than
 * importing it: a client module that reaches into src/server is how a server
 * only module ends up in a browser bundle, which the guard in
 * test/secrets.test.ts refuses.
 */
export interface BackingView {
  roundId: string | null;
  /** True only while the pit is in the backing phase and the clock agrees. */
  open: boolean;
  closesAt: string | null;
  /** Backers per agent id. */
  counts: Record<string, number>;
  backers: number;
  /** This handle's pick, when a handle was asked about. */
  pick: string | null;
}

/** How often the tallies are asked for while the window is open. */
export const TALLY_POLL_MS = 2_000;

/** The only thing a viewer is told when the tallies cannot be reached. */
export const BACKING_UNREACHABLE = "Could not reach the pit just then. Still trying.";

export interface BackingFeed {
  view: BackingView | null;
  /** A plain sentence about the last pick that failed, or null. */
  error: string | null;
  /** Sends a pick. Resolves to an error sentence, or null when it landed. */
  pick: (handle: string, token: string, agentId: string) => Promise<string | null>;
  clearError: () => void;
}

/** Phases where the tallies are worth asking for again. */
const MOVING = new Set(["backing"]);

export function useBackingFeed(enabled: boolean, roundId: string | null, phase: string | null, handle: string | null): BackingFeed {
  const [view, setView] = useState<BackingView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !roundId) return;
    let alive = true;

    // Defined in here, like the arena feed's loader, so the only thing that
    // sets state is the answer coming back rather than the effect running.
    const load = async (): Promise<void> => {
      try {
        const query = handle ? `?handle=${encodeURIComponent(handle)}` : "";
        const response = await fetch(`/api/backing${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as BackingView;
        if (alive) setView(body);
      } catch {
        // Never the thrown error: a fetch failure quotes the url it tried.
        // Silent, because the tallies are not what a viewer came for and the
        // round on screen is unaffected by a poll that missed.
      }
    };

    void load();
    const timer = phase && MOVING.has(phase) ? setInterval(() => void load(), TALLY_POLL_MS) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [enabled, roundId, phase, handle]);

  const pick = useCallback(
    async (pickHandle: string, token: string, agentId: string): Promise<string | null> => {
      try {
        const response = await fetch("/api/backing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle: pickHandle, token, agentId }),
        });
        const body = (await response.json()) as BackingView & { error?: string };
        if (!response.ok) {
          // The server's sentence, which is written for a viewer. Anything
          // else it might have said never reaches here.
          const message = typeof body.error === "string" ? body.error : BACKING_UNREACHABLE;
          setError(message);
          return message;
        }
        setView(body);
        setError(null);
        return null;
      } catch {
        setError(BACKING_UNREACHABLE);
        return BACKING_UNREACHABLE;
      }
    },
    [],
  );

  return { view, error, pick, clearError: () => setError(null) };
}
