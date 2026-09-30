// Renders the trailer page to an mp4, one frame at a time, with its sound.
//
// The page draws frame n as a pure function of n (see src/main.ts), so a
// headless browser can take as long as it likes over each one and the video
// still comes out at an exact 30 fps, the same on every run. Frames go to
// ffmpeg as lossless PNG; the only lossy step is the final H.264 encode.
//
// The sound is the game's own, from the Ninja Adventure pack (CC0), laid on
// the page's own cues: the fight music under the fight, the pit music under
// the rest, and the pack's UI sounds where a quote, a hash or a figure lands.
//
//   cd docs/trailer && npm ci --ignore-scripts
//   node render.mjs                                  landscape, 1920x1080
//   node render.mjs --format vertical                vertical, 1080x1920
//   node render.mjs --out out/name.mp4               another output path
//
// FFMPEG and CHROMIUM name the binaries when they are not on the path.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(resolve(here, "..", ".."), "public", "assets", "audio");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const SOUNDS = new Set(["uiSelect", "payoutTransient", "winSting", "leverPull", "jackpotSting"]);

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const format = flag("--format", "landscape");
if (format !== "landscape" && format !== "vertical") throw new Error("--format is landscape or vertical");
const out = resolve(here, flag("--out", `out/servpit-trailer${format === "vertical" ? "-vertical" : ""}.mp4`));
if (!out.endsWith(".mp4")) throw new Error("--out must be an .mp4 path");
mkdirSync(dirname(out), { recursive: true });

// Starts the loopback server (PORT, default 8089) for the length of the render.
const { server } = await import("./serve.mjs");
const port = server.address().port;

const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
};

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
  const size = format === "vertical" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const page = await (await browser.newContext({ viewport: size, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/${format === "vertical" ? "?format=vertical" : ""}`);
  const info = await page.evaluate(async () => {
    await window.TRAILER.ready;
    const t = window.TRAILER;
    return { fps: t.fps, frames: t.frames, width: t.width, height: t.height, cues: t.cues(), beats: t.beats() };
  });
  if (errors.length > 0) throw new Error(`page error: ${errors.join("; ")}`);
  if (info.width !== size.width || info.height !== size.height) throw new Error("page and viewport disagree on size");
  writeFileSync(out.replace(/\.mp4$/, ".cues.json"), JSON.stringify(info, null, 1) + "\n");

  // Picture.
  const silent = out.replace(/\.mp4$/, ".video.mp4");
  const ff = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(info.fps), "-c:v", "png", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation", "-pix_fmt", "yuv420p", "-r", String(info.fps), "-movflags", "+faststart", silent], { stdio: ["pipe", "inherit", "inherit"] });
  const encoded = new Promise((ok, fail) => ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`)))));
  const started = Date.now();
  for (let n = 0; n < info.frames; n++) {
    await page.evaluate((i) => window.TRAILER.renderFrame(i), n);
    const png = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once("drain", ok));
    if (n % 300 === 0) console.log(`frame ${n}/${info.frames}, ${Math.round((Date.now() - started) / 1000)}s`);
  }
  ff.stdin.end();
  await encoded;
  if (errors.length > 0) throw new Error(`page error: ${errors.join("; ")}`);

  // Sound, laid on the page's cues, then muxed without touching the picture.
  const { cues, beats } = info;
  const D = info.frames / info.fps;
  const ms = (s) => Math.round(s * 1000);
  const placed = beats.filter((b) => SOUNDS.has(b.sfx) && b.at >= 0 && b.at < D);
  const VOLUME = { uiSelect: 0.55, payoutTransient: 0.7, winSting: 0.9, leverPull: 0.8, jackpotSting: 0.9 };
  const fightOut = cues.six - 0.6;
  const filters = [
    `[1:a]atrim=0:${cues.six + 0.6},afade=t=in:d=0.6,afade=t=out:st=${fightOut}:d=1.2,volume=0.6,aresample=44100,aformat=channel_layouts=stereo[mf]`,
    `[2:a]atrim=0:${D - fightOut},afade=t=in:d=1.2,afade=t=out:st=${D - fightOut - 3}:d=3,volume=0.5,adelay=${ms(fightOut)}|${ms(fightOut)},aresample=44100,aformat=channel_layouts=stereo[mp]`,
  ];
  const labels = ["[mf]", "[mp]"];
  placed.forEach((b, i) => {
    filters.push(`[${i + 3}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${VOLUME[b.sfx]},adelay=${ms(b.at)}|${ms(b.at)}[s${i}]`);
    labels.push(`[s${i}]`);
  });
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,atrim=0:${D},alimiter=limit=0.9[aout]`);
  const mix = ["-hide_banner", "-loglevel", "error", "-y", "-i", silent, "-i", join(AUDIO, "musicFight.ogg"), "-stream_loop", "-1", "-i", join(AUDIO, "musicPit.ogg")];
  for (const b of placed) mix.push("-i", join(AUDIO, `${b.sfx}.wav`));
  mix.push("-filter_complex", filters.join(";"), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(D), "-movflags", "+faststart", out);
  run(FFMPEG, mix);
  rmSync(silent);

  console.log(`rendered ${out}: ${info.frames} frames at ${info.fps} fps, ${D}s, ${info.width}x${info.height}, ${(statSync(out).size / 1e6).toFixed(1)} MB, ${placed.length} sound cues`);
} finally {
  await browser?.close();
  server.close();
}
