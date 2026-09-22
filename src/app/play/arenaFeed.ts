"use client";

// The viewer's connection to the pit.
//
// Two channels, on purpose. The stream says when a phase changes, which is
// the only thing that has to be immediate. The endpoint carries the round
// itself, and is asked for whenever the stream says something moved, when the
// stream drops, and on a slow tick underneath both so a viewer whose stream
// never connects still sees the round.
//
// Everything a viewer is told here is a sentence written in this file. A
// fetch failure, a transport error and a stack trace all become the same
// short line, because none of them are for a player and one of them can carry
// an operator's credentials.

import { useEffect, useRef, useState } from "react";
import type { ArenaFeedView } from "./arenaScreens";

/** How often the round is fetched when the stream is quiet. */
export const IDLE_POLL_MS = 10_000;
/** How often it is fetched while the stream is down. */
export const RECONNECT_POLL_MS = 3_000;
/** How long to wait before opening the stream again, doubling to the cap. */
export const RETRY_BASE_MS = 1_000;
export const RETRY_MAX_MS = 15_000;

export type FeedConnection = "connecting" | "live" | "retrying";

export interface ArenaFeed {
  view: ArenaFeedView | null;
  connection: FeedConnection;
  /** A plain sentence when the pit cannot be reached, or null. */
  error: string | null;
}

/** The only thing a viewer is ever told about a failure here. */
export const FEED_UNREACHABLE = "Lost the pit for a moment. Still trying.";

export function useArenaFeed(enabled: boolean): ArenaFeed {
  const [view, setView] = useState<ArenaFeedView | null>(null);
  const [connection, setConnection] = useState<FeedConnection>("connecting");
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so the fetch loop below never restarts when it changes.
  const failures = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/arena", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as ArenaFeedView;
        if (!alive) return;
        setView(body);
        failures.current = 0;
        setError(null);
      } catch {
        // Never the thrown error: a fetch failure quotes the url it tried.
        if (!alive) return;
        failures.current += 1;
        // One bad request happens. Two in a row is worth saying out loud.
        if (failures.current > 1) setError(FEED_UNREACHABLE);
      }
    };

    const startPolling = (everyMs: number): void => {
      if (poll) clearInterval(poll);
      poll = setInterval(() => void load(), everyMs);
    };

    const open = (): void => {
      if (!alive) return;
      source = new EventSource("/api/arena/stream");
      source.addEventListener("open", () => {
        if (!alive) return;
        setConnection("live");
        setError(null);
        // The stream is the fast path; the poll underneath it is the slow
        // safety net rather than the thing that keeps the screen current.
        startPolling(IDLE_POLL_MS);
      });
      source.addEventListener("phase", () => {
        // The event says something moved. What moved comes from the endpoint,
        // so there is one shape on screen and one place it is built.
        void load();
      });
      source.addEventListener("error", () => {
        if (!alive) return;
        source?.close();
        source = null;
        setConnection("retrying");
        // Keep asking while the stream is down, so a viewer still sees the
        // round change even if the stream never comes back.
        startPolling(RECONNECT_POLL_MS);
        const waitMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures.current, 4));
        retry = setTimeout(open, waitMs);
      });
    };

    void load();
    startPolling(RECONNECT_POLL_MS);
    open();

    return () => {
      alive = false;
      source?.close();
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
    };
  }, [enabled]);

  return { view, connection, error };
}
