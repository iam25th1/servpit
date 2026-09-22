// Who a pick belongs to.
//
// A handle is a name on a leaderboard, not an account: there is no password
// and nothing to recover. What stops one visitor picking under another's
// handle is a random token the browser makes once and keeps, of which only a
// hash is ever stored. The first pick under a handle binds it to that hash,
// and every later pick under it has to prove the same token.
//
// The token is never written down here, so a copy of the data directory is
// not a set of credentials: it is a set of hashes that can confirm a token
// somebody presents and cannot produce one.
//
// This is deliberately not an identity system. Handles are unverified, one
// person can hold several, and the README says so. It protects a name from
// being taken over, which is all a points board needs.

import { createHash } from "node:crypto";

/** Shortest token accepted. A randomUUID is 36 characters. */
export const MIN_TOKEN_LENGTH = 16;
/** Longest, so a request cannot make the server hash a megabyte. */
export const MAX_TOKEN_LENGTH = 200;

/** The token as it arrived, or null when it is not one. */
export function validToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/** What is stored: the hash, never the token. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
