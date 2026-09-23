"use client";

// A fighter of your own, from the viewer's side.
//
// Asked for when a handle exists and again after a claim, and nothing else:
// a claim changes on a person's own action rather than on the pit's clock, so
// there is no poll here and no timer in this file.

import { useCallback, useEffect, useState } from "react";

/** The slice of the fighter endpoint this file reads. Mirrored, not imported. */
export interface FighterView {
  fighter: { handle: string; name: string; face: string; entrantId: string } | null;
  freeFaces: string[];
  message: string;
  /** This fighter's record, or null before it has been in a round. */
  career?: {
    handle: string;
    name: string;
    face: string;
    rounds: number;
    wins: number;
    best: number;
    kills: number;
    streak: number;
    longest: number;
  } | null;
}

/** The only thing a viewer is told when the pit cannot be reached. */
export const FIGHTER_UNREACHABLE = "Could not reach the pit just then. Try that again.";

export interface FighterFeed {
  view: FighterView | null;
  /** A plain sentence about the last claim that failed, or null. */
  error: string | null;
  /** True between asking and being answered. */
  claiming: boolean;
  /** Claims a seat. Resolves to an error sentence, or null when it landed. */
  claim: (name: string, face: string) => Promise<string | null>;
}

export function useFighterFeed(enabled: boolean, handle: string | null, token: string): FighterFeed {
  const [view, setView] = useState<FighterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!enabled || handle === null) return;
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`/api/fighter?handle=${encodeURIComponent(handle)}&token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as FighterView;
        if (alive) setView(body);
      } catch {
        // Never the thrown error: a fetch failure quotes the url it tried,
        // and a missed read leaves the panel saying what it last knew.
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, handle, token]);

  const claim = useCallback(
    async (name: string, face: string): Promise<string | null> => {
      if (handle === null) return "Choose a handle first.";
      setClaiming(true);
      try {
        const response = await fetch("/api/fighter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle, token, name, face }),
        });
        const body = (await response.json()) as FighterView & { error?: string };
        if (!response.ok) {
          // The server's sentence, which is written for a viewer.
          const message = typeof body.error === "string" ? body.error : FIGHTER_UNREACHABLE;
          setError(message);
          return message;
        }
        setView(body);
        setError(null);
        return null;
      } catch {
        setError(FIGHTER_UNREACHABLE);
        return FIGHTER_UNREACHABLE;
      } finally {
        setClaiming(false);
      }
    },
    [handle, token],
  );

  // Nothing is shown for a browser with no handle, worked out at render
  // rather than cleared in the effect: setting state from an effect to say
  // "there is nothing" is a render that answers itself.
  return { view: enabled && handle !== null ? view : null, error, claiming, claim };
}
