// Prints N u32 draws for a seed as a comma separated line.
// Used by rng.test.ts to prove determinism across processes.
import { createRng } from "../../src/engine/rng";

const [seed = "", countArg = "10000"] = process.argv.slice(2);
const count = Number.parseInt(countArg, 10);
const rng = createRng(seed);
const out: number[] = [];
for (let i = 0; i < count; i++) out.push(rng.nextU32());
process.stdout.write(out.join(",") + "\n");
