"use client";

// The viewer's side of the lever.
//
// What it needs to know changes on its own clock rather than with the round:
// a pull ages out of the window while nothing on screen moves, and the day's
// reasoning budget is spent by rounds nobody at this screen started. So it is
// polled, slowly, and only while the pit is somewhere a pull could land.
//
// This file, backingFeed.ts, arenaClock.ts and arenaFeed.ts are the only
// places in the play screen allowed a timer, which the guard in
// src/render/timeline.test.ts names and explains. A poll is wall time, not
// animation: nothing on a canvas is driven from here.

import { useCallback, useEffect, useState } from "react";

/**
 * The slice of the pull endpoint this file reads. Mirrors it, rather than
 * importing it: a client module that reaches into src/server is how a server
 * only module ends up in a browser bundle, which the guard in
 * test/secrets.test.ts refuses.
 */
export interface PullView {
  queued: boolean;
  message: string;
  /** Pulls left in the window, or null when the operator has lifted the limit. */
  left: number | null;
  resetsAt: string | null;
  /** Whether a round pulled now would reason, stated before pulling. */
  willReason: boolean;
  /** Why it would not, in plain words, or null when it would. */
  reasonBlocked: string | null;
}

/** How often the lever's state is asked for. Slow: none of it moves fast. */
export const PULL_POLL_MS = 20_000;

/** The only thing a viewer is told when the pit cannot be reached. */
export const PULL_UNREACHABLE = "Could not reach the pit just then. Try that again.";

export interface PullFeed {
  view: PullView | null;
  /** A plain sentence about the last pull that failed, or null. */
  error: string | null;
  /** True between asking and being answered, so the control can say so. */
  pulling: boolean;
  /** Asks for a round. Resolves to an error sentence, or null when it landed. */
  pull: (handle: string, token: string) => Promise<string | null>;
  clearError: () => void;
}

export function usePullFeed(enabled: boolean, handle: string | null, token: string | null): PullFeed {
  const [view, setView] = useState<PullView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    // Defined in here, like the backing feed's loader, so the only thing that
    // sets state is the answer coming back rather than the effect running.
    const load = async (): Promise<void> => {
      try {
        const query = handle && token ? `?handle=${encodeURIComponent(handle)}&token=${encodeURIComponent(token)}` : "";
        const response = await fetch(`/api/pull${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as PullView;
        if (alive) setView(body);
      } catch {
        // Never the thrown error: a fetch failure quotes the url it tried.
        // Silent, because the round on screen is unaffected by a poll that
        // missed and the lever says what it last knew.
      }
    };

    void load();
    const timer = setInterval(() => void load(), PULL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, handle, token]);

  const pull = useCallback(async (pullHandle: string, pullToken: string): Promise<string | null> => {
    setPulling(true);
    try {
      const response = await fetch("/api/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: pullHandle, token: pullToken }),
      });
      const body = (await response.json()) as PullView & { error?: string };
      if (!response.ok) {
        // The server's sentence, which is written for a viewer. Anything else
        // it might have said never reaches here.
        const message = typeof body.error === "string" ? body.error : PULL_UNREACHABLE;
        setError(message);
        return message;
      }
      setView(body);
      setError(null);
      return null;
    } catch {
      setError(PULL_UNREACHABLE);
      return PULL_UNREACHABLE;
    } finally {
      setPulling(false);
    }
  }, []);

  return { view, error, pulling, pull, clearError: () => setError(null) };
}
