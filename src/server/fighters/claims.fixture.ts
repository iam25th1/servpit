// A second process claiming seats, for the concurrency test next to it.
//
// Run as: tsx claims.fixture.ts <file> <handlePrefix> <count> <face>
// Every process asks for the same face first, which is the race the log has
// to settle: one of them gets it and the rest are told so.

import { FighterStore } from "./log";

const [file, prefix, count, face] = process.argv.slice(2);
const store = new FighterStore(file!, "fake");
for (let i = 0; i < Number(count); i += 1) {
  const answer = store.claim({ handle: `${prefix}-${i}`, tokenHash: `token-${prefix}-${i}`, name: `F${i}`, face: face! });
  process.stdout.write(`${answer.outcome}\n`);
}
