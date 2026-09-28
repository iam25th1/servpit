// Records one take of real gameplay from a running pit.
//
// Plays the part of a viewer: enters the pit, picks a handle, predicts all six
// agents, pulls the lever, backs an agent and watches the fight through to the
// result, while the browser's own screencast writes every painted frame to
// disk with its timestamp. The marks it leaves (pull, reels, backing, fight,
// result) are what the composition cuts on.
//
//   node capture.mjs [take-name]        pit at http://localhost:3000
//   PIT=http://localhost:7530 node capture.mjs
//
// Prints the round's winner. A house bot wins most rounds, so a trailer that
// wants an agent to win takes more than one take.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const PIT = process.env.PIT ?? "http://localhost:3000";
const OUT = join(here, "footage", process.argv[2] ?? "latest");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
// The stage is 1280 by 720 and renders at a whole number scale, so this is
// the stage edge to edge. The screencast sends frames in these pixels.
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const arena = async () => (await (await fetch(`${PIT}/api/arena`)).json());
const until = async (test, ms = 300_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const view = await arena().catch(() => ({}));
    if (test(view)) return view;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};

const cdp = await page.context().newCDPSession(page);
const frames = [];
const marks = [];
let t0 = null;
cdp.on("Page.screencastFrame", async (f) => {
  const ts = f.metadata.timestamp;
  if (t0 === null) t0 = ts;
  const name = `f${String(frames.length).padStart(5, "0")}.jpg`;
  writeFileSync(join(OUT, name), Buffer.from(f.data, "base64"));
  frames.push({ name, t: ts - t0 });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
const now = () => (frames.length ? frames[frames.length - 1].t : 0);
const mark = (label) => marks.push({ label, t: now() });
const wait = (ms) => page.waitForTimeout(ms);

await page.addInitScript(() => localStorage.setItem("servpit.onboarding.seen", "true"));
await page.goto(`${PIT}/`, { waitUntil: "load" });
await wait(1500);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
await wait(500);
mark("title");
await wait(4000);
await page.getByRole("button", { name: /enter the pit/i }).click();
mark("enter");
await wait(3500);
mark("resting");
const field = page.locator("#handle-field");
if (await field.count()) {
  await field.click();
  await field.pressSequentially(process.env.HANDLE ?? "cupcake", { delay: 90 });
  await page.getByRole("button", { name: "Use this handle" }).click();
}
await wait(1500);
mark("predict");
for (const [name, call] of [["Atlas", "fights"], ["Blaze", "fights"], ["Comet", "sits out"], ["Delta", "fights"], ["Ember", "sits out"], ["Flint", "fights"]]) {
  await page.getByRole("button", { name: `${name} ${call}` }).click();
  await wait(550);
}
await wait(1500);
mark("predicted");
const before = (await arena()).round?.roundId;
const pull = page.getByRole("button", { name: /pull the lever/i }).first();
await pull.hover();
await wait(600);
await pull.click();
mark("pull");
const started = await until((d) => d.round && d.round.roundId !== before);
const id = started.round.roundId;
await until((d) => d.round?.roundId === id && d.round.phase === "reels");
mark("reels");
await until((d) => d.round?.roundId === id && d.round.phase === "backing");
mark("backing");
await wait(2500);
const back = page.getByRole("button", { name: "Back", exact: true }).nth(1);
if (await back.count()) {
  await back.hover();
  await wait(500);
  await back.click();
  mark("backed");
}
await until((d) => d.round?.roundId === id && d.round.phase === "fight");
mark("fight");
const done = await until((d) => d.round?.roundId === id && d.round.phase === "result");
mark("result");
await wait(9000);
mark("end");
await cdp.send("Page.stopScreencast");
await wait(300);
const winner = done?.round?.result?.winner ?? null;
writeFileSync(join(OUT, "index.json"), JSON.stringify({ frames, marks, winner }, null, 1));
console.log(`take ${OUT}: ${frames.length} frames, ${now().toFixed(1)}s, winner ${winner}`);
await browser.close();
