// A writer to interrupt. Used by file.test.ts, which kills it mid write and
// then reads what is on disk.
//
// It writes a store large enough that a write is not instantaneous, over and
// over, so a kill at any moment has a good chance of landing inside one. If
// the atomic write works, the file on disk is always a whole store: either
// the one before the kill or the one after it, never a truncated tail.

import { writeStoreFile } from "./file";

const file = process.argv[2];
if (!file) throw new RangeError("usage: interruptedWrite.fixture.ts <file>");

const row = (i: number) => ({ id: `row-${i}`, note: "x".repeat(200), amountWei: String(10n ** 18n + BigInt(i)) });

let round = 0;
for (;;) {
  round++;
  const rows = Array.from({ length: 4_000 }, (_, i) => row(i + round));
  writeStoreFile(file, { version: 1, round, rows }, "fake");
  if (round === 1) process.stdout.write("ready\n");
}
