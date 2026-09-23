"use client";

// Choosing a handle, with a way out of every answer.
//
// The handle used to be stored the moment it was typed and checked by nobody.
// A visitor who chose a name another browser holds was told "backing as ash"
// over a server that refused every write under it, with no field left on
// screen to change it and nothing to change it to. This asks first, keeps the
// field open when the answer is no, and offers names that are free.
//
// The check is advice, not authority: the claim still happens where it always
// did, on the first pick or the first pull, under the append lock. A handle
// that goes from free to taken between the check and the write is refused
// there, and that refusal comes back through here too.

import { useCallback, useEffect, useState } from "react";
import { normaliseHandle } from "@/config/backing";
import { setBackerHandle, type StorageLike } from "./backerId";

/** The slice of the handle endpoint this file reads. Mirrored, not imported. */
export interface HandleView {
  handle: string | null;
  state: "free" | "yours" | "taken" | null;
  message: string;
  suggestions: string[];
}

/** The only thing a viewer is told when the pit cannot be reached. */
export const HANDLE_UNREACHABLE = "Could not reach the pit just then. Try that again.";

export interface HandleClaim {
  /** The handle this browser is using, or null while there is none. */
  handle: string | null;
  /** True while the field should be on screen, which is whenever there is no handle. */
  choosing: boolean;
  /** What the pit said about the last attempt, or null. */
  message: string | null;
  /** Free names to take instead. Empty unless the last answer was taken. */
  suggestions: string[];
  /** True between asking and being answered. */
  checking: boolean;
  /** Tries to take a handle. Resolves to true when it is now this browser's. */
  claim: (raw: string) => Promise<boolean>;
  /** Puts the field back, for a visitor who wants a different name. */
  change: () => void;
  /** What a refused write says, so a late refusal reopens the field too. */
  refused: (message: string) => void;
}

export function useHandleClaim(store: StorageLike, token: string, initial: string | null): HandleClaim {
  const [handle, setHandle] = useState<string | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  const look = useCallback(
    async (candidate: string): Promise<HandleView | null> => {
      try {
        const response = await fetch(`/api/handle?handle=${encodeURIComponent(candidate)}&token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!response.ok) return null;
        return (await response.json()) as HandleView;
      } catch {
        // Never the thrown error: a fetch failure quotes the url it tried.
        return null;
      }
    },
    [token],
  );

  // A handle kept from an earlier visit is checked once, because the pit is
  // where the claim lives and this browser may have lost it. Anybody already
  // stuck with a name they cannot use gets the field back here.
  useEffect(() => {
    if (initial === null) return;
    let alive = true;
    void (async () => {
      const view = await look(initial);
      if (!alive || view === null) return;
      if (view.state === "taken") {
        setHandle(null);
        setMessage(view.message);
        setSuggestions(view.suggestions);
      }
    })();
    return () => {
      alive = false;
    };
  }, [initial, look]);

  const claim = useCallback(
    async (raw: string): Promise<boolean> => {
      const candidate = normaliseHandle(raw);
      if (candidate === null) {
        setMessage("A handle is 3 to 16 letters, numbers, dashes or underscores.");
        setSuggestions([]);
        return false;
      }
      setChecking(true);
      try {
        const view = await look(candidate);
        if (view === null) {
          setMessage(HANDLE_UNREACHABLE);
          setSuggestions([]);
          return false;
        }
        if (view.state === "taken") {
          setMessage(view.message);
          setSuggestions(view.suggestions);
          return false;
        }
        const kept = setBackerHandle(store, candidate);
        if (kept === null) {
          setMessage("A handle is 3 to 16 letters, numbers, dashes or underscores.");
          return false;
        }
        setHandle(kept);
        setMessage(null);
        setSuggestions([]);
        return true;
      } finally {
        setChecking(false);
      }
    },
    [look, store],
  );

  const change = useCallback(() => {
    setHandle(null);
    setMessage(null);
    setSuggestions([]);
  }, []);

  const refused = useCallback((sentence: string) => {
    // A write refused under this handle means it is not ours after all, so
    // the field comes back with the pit's own words above it.
    setHandle(null);
    setMessage(sentence);
    setSuggestions([]);
  }, []);

  return { handle, choosing: handle === null, message, suggestions, checking, claim, change, refused };
}
