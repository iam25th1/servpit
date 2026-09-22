// Who this browser is, for backing.
//
// A handle is a name on a board. The token is what stops somebody else using
// that name: it is made here, once, kept in this browser, and only its hash
// ever reaches the server. Nothing about it is an account, and losing it
// means losing the handle, which is the trade a points board can afford.
//
// Storage is passed in rather than reached for, so the rules are testable
// without a browser and a page rendered on the server never touches it.

import { normaliseHandle } from "@/config/backing";

export const TOKEN_KEY = "servpit.backing.token";
export const HANDLE_KEY = "servpit.backing.handle";

/** The slice of Storage this uses, which is all of it a name needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A store that forgets, for a browser that refuses one and for the server. */
export function memoryStore(): StorageLike {
  const held = new Map<string, string>();
  return { getItem: (k) => held.get(k) ?? null, setItem: (k, v) => void held.set(k, v) };
}

/** This browser's storage, or one that forgets when it cannot be reached. */
export function browserStore(): StorageLike {
  try {
    // Private windows and blocked site data both throw on access rather than
    // returning null, so the try is around the reach as well as the read.
    const store = globalThis.localStorage;
    store.getItem(TOKEN_KEY);
    return store;
  } catch {
    return memoryStore();
  }
}

/** The token for this browser, made once and kept. */
export function backerToken(store: StorageLike, make: () => string = () => crypto.randomUUID()): string {
  try {
    const held = store.getItem(TOKEN_KEY);
    if (held && held.length >= 16) return held;
    const token = make();
    store.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    // A browser that will not store it still gets to back a round; it just
    // cannot keep the handle past a reload.
    return make();
  }
}

/** The handle this browser backs under, or null until one is chosen. */
export function backerHandle(store: StorageLike): string | null {
  try {
    return normaliseHandle(store.getItem(HANDLE_KEY));
  } catch {
    return null;
  }
}

/** Keeps a handle, in the one form the server stores it in, or refuses it. */
export function setBackerHandle(store: StorageLike, raw: string): string | null {
  const handle = normaliseHandle(raw);
  if (handle === null) return null;
  try {
    store.setItem(HANDLE_KEY, handle);
  } catch {
    // Not fatal: the pick carries the handle, the storage only remembers it.
  }
  return handle;
}
