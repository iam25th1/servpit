// A second process making picks, for the concurrency test next to it.
//
// Run as: tsx picks.fixture.ts <file> <handlePrefix> <count> <agentId>
// It makes one pick per handle as fast as it can, which is the shape of many
// viewers backing at the same moment.

import { PickStore } from "./picks";

const [file, prefix, count, agentId] = process.argv.slice(2);
const store = new PickStore(file!, "fake");
for (let i = 0; i < Number(count); i++) {
  store.record("r-crowd", `${prefix}-${i}`, `token-${prefix}-${i}`, agentId!);
}
