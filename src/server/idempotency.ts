// Deterministic idempotency keys. CDP accepts a uuid per user operation and
// dedupes on it; our ledger dedupes on the same key first. round id plus
// agent id plus kind is the whole identity of a transfer, so a retry of the
// same transfer always carries the same key and can never double pay.

import { createHash } from "node:crypto";

const PART = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * loan is the bank paying out an approved advance, bank wallet to agent
 * wallet. It is a transfer like any other and carries the same identity, so a
 * retry of the same round and agent can never disburse twice.
 */
/**
 * loan       the bank paying out an approved advance
 * repayment  a winner paying its creditor out of what it just won
 * seizure    the bank taking what a wrecked agent still holds
 * refill     operator capital funding a replacement into an empty seat
 *
 * Every one carries the same round id, agent id and kind identity, so a
 * retry of the same event can never move money twice.
 */
export type TransferKind = "entry" | "payout" | "loan" | "repayment" | "seizure" | "refill";

export function idempotencyKey(roundId: string, agentId: string, kind: TransferKind): string {
  for (const [name, value] of [["roundId", roundId], ["agentId", agentId], ["kind", kind]] as const) {
    if (typeof value !== "string" || !PART.test(value)) throw new RangeError(`${name} must match ${PART}`);
  }
  const digest = createHash("sha256").update(`servpit-transfer/${roundId}/${agentId}/${kind}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
