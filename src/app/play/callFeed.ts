"use client";

// A visitor's calls, from the viewer's side.
//
// Asked for when the round on screen or its phase changes, and when a call is
// made, and at no other time: calls change on a person's own action or on a
// phase the stream already reports, so there is no poll here and no timer in
// this file.

import { useCallback, useEffect, useState } from "react";
import type { Calls } from "@/config/reads";

/**
 * The slice of the calls endpoint this file reads. Mirrors it, rather than
 * importing it: a client module that reaches into src/server is how a server
 * only module ends up in a browser bundle, which the guard in
 * test/secrets.test.ts refuses.
 */
export interface CallsView {
  /** True while calls on the next round are being taken. */
  open: boolean;
  /** This handle's calls on the next round, or null. */
  mine: Calls | null;
  /** How many visitors have called the next round so far. */
  callers: number;
  /** The round on file and this handle's calls on it, or null. */
  round: { roundId: string; mine: Calls | null } | null;
}

/** The only thing a viewer is told when the pit cannot be reached. */
export const CALLS_UNREACHABLE = "Could not reach the pit just then. Your calls are kept here, try again.";

export interface CallFeed {
  view: CallsView | null;
  /** A plain sentence about the last save that failed, or null. */
  error: string | null;
  /** True between sending calls and hearing back. */
  saving: boolean;
  /** Sends a whole set of calls. Resolves to an error sentence, or null when it landed. */
  save: (handle: string, token: string, calls: Calls) => Promise<string | null>;
}

export function useCallFeed(enabled: boolean, handle: string | null, token: string, key: string): CallFeed {
  const [view, setView] = useState<CallsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      try {
        // The token, because a handle's own calls are only told to the
        // browser that owns it.
        const query = handle ? `?handle=${encodeURIComponent(handle)}&token=${encodeURIComponent(token)}` : "";
        const response = await fetch(`/api/calls${query}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as CallsView;
        if (alive) setView(body);
      } catch {
        // Never the thrown error: a fetch failure quotes the url it tried,
        // and a missed read leaves the panel saying what it last knew.
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, handle, token, key]);

  const save = useCallback(async (saveHandle: string, saveToken: string, calls: Calls): Promise<string | null> => {
    setSaving(true);
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: saveHandle, token: saveToken, calls }),
      });
      const body = (await response.json()) as CallsView & { error?: string };
      if (!response.ok) {
        // The server's sentence, which is written for a viewer.
        const message = typeof body.error === "string" ? body.error : CALLS_UNREACHABLE;
        setError(message);
        return message;
      }
      setView(body);
      setError(null);
      return null;
    } catch {
      setError(CALLS_UNREACHABLE);
      return CALLS_UNREACHABLE;
    } finally {
      setSaving(false);
    }
  }, []);

  return { view: enabled ? view : null, error, saving, save };
}
