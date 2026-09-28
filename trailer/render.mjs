// Renders the trailer frame by frame and pipes JPEGs into ffmpeg.
//
// The composition exposes renderAt(t), a pure function of time, so a frame is
// the same however long the browser took to draw it. That is what lets a
// headless browser make a smooth 30 fps video.
//
//   node serve.mjs &            (TAKE=<take> for a take other than "latest")
//   node render.mjs out/video.mp4
//
// Writes timeline.json beside the video for mix.mjs to lay the audio from.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-core";

const FPS = 30;
const OUT = process.argv[2] ?? "out/video.mp4";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const URL_ = process.env.TRAILER_URL ?? "http://127.0.0.1:8088/";
mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto(URL_);
const info = await page.evaluate(async () => {
  await window.TRAILER.ready;
  return { d: window.TRAILER.DURATION, T: window.TRAILER.T, cues: window.TRAILER.CUES, marks: window.FOOT.marks };
});
writeFileSync(`${dirname(OUT)}/timeline.json`, JSON.stringify(info, null, 1));

const frames = Math.round(info.d * FPS);
const ff = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
const started = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.TRAILER.renderAt(t), i / FPS);
  const jpeg = await page.screenshot({ type: "jpeg", quality: 94 });
  if (!ff.stdin.write(jpeg)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % 150 === 0) console.log(`frame ${i}/${frames} ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log("rendered", OUT);
