// A second process asking for rounds, for the concurrency test next to it.
//
// Run as: tsx pulls.fixture.ts <file> <handle> <count>
// It asks as fast as it can, which is the shape of a crowd finding the lever
// at the same moment. It prints one line per ask so the test can count what
// each process was told.

import { PullStore } from "./log";

const [file, handle, count] = process.argv.slice(2);
const store = new PullStore(file!, "fake");
for (let i = 0; i < Number(count); i += 1) {
  const answer = store.request(handle!, `token-${handle}`);
  process.stdout.write(`${answer.outcome}\n`);
}
