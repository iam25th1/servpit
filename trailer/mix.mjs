// Lays the soundtrack under the rendered video and muxes the two.
//
// The pit's music for the explainer half, the fight music from the lever on,
// and the game's own sound effects on cues: the composition's own list, plus
// the ones that belong to a moment in the footage (the lever, the reels, the
// clicks, the result), placed from the timeline render.mjs wrote.
//
//   node mix.mjs out/video.mp4 out/servpit-trailer.mp4
//
// All audio is from the Ninja Adventure pack, CC0.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(resolve(here, ".."), "public", "assets", "audio");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const [video, out] = process.argv.slice(2);
if (!video || !out) throw new Error("usage: node mix.mjs <video.mp4> <out.mp4>");

const tl = JSON.parse(readFileSync(join(dirname(video), "timeline.json"), "utf8"));
const { T, d: D } = tl;
const marks = Object.fromEntries(tl.marks.map((m) => [m.label, m.t]));
// Must match LEVER_PRESS and REEL_STOPS in index.html.
const LEVER_PRESS = 1.1;
const REEL_STOPS = [1.3, 2.0, 2.9];

const cues = [...tl.cues];
const lever = T.lever[0];
cues.push({ at: lever + LEVER_PRESS - 0.35, sfx: "leverPull" });
cues.push({ at: lever + LEVER_PRESS, sfx: "reelSpin" });
for (const stop of REEL_STOPS) cues.push({ at: lever + LEVER_PRESS + stop, sfx: "reelStop" });
for (let i = 0; i < 6; i++) cues.push({ at: T.predict[0] + 0.5 + i * 0.55, sfx: "uiSelect" });
if (marks.backed !== undefined) cues.push({ at: T.backing[0] + (marks.backed - marks.backing - 0.9), sfx: "uiLocked" });
cues.push({ at: T.result[0] + 0.15, sfx: "winSting" });
cues.push({ at: T.result[0] + 0.6, sfx: "payoutBody" });
const placed = cues.filter((c) => c.at >= 0 && c.at < D);

const VOLUME = { reelSpin: 0.55, uiSelect: 0.7, reelStop: 0.8, jackpotSting: 1, winSting: 1 };
const fightAt = lever - 0.2;
const ms = (s) => Math.round(s * 1000);
const filters = [
  `[1:a]atrim=0:${fightAt + 0.6},afade=t=in:d=0.8,afade=t=out:st=${fightAt - 0.2}:d=0.8,volume=0.55,aresample=44100[mp]`,
  `[2:a]atrim=0:${D - fightAt},afade=t=in:d=0.3,afade=t=out:st=${D - fightAt - 2.2}:d=2.2,volume=0.6,adelay=${ms(fightAt)}|${ms(fightAt)},aresample=44100[mf]`,
];
const labels = ["[mp]", "[mf]"];
placed.forEach((c, i) => {
  const trim = c.sfx === "reelSpin" ? ",atrim=0:3.0" : "";
  filters.push(`[${i + 3}:a]aresample=44100,aformat=channel_layouts=stereo${trim},volume=${VOLUME[c.sfx] ?? 0.85},adelay=${ms(c.at)}|${ms(c.at)}[s${i}]`);
  labels.push(`[s${i}]`);
});
filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,atrim=0:${D},alimiter=limit=0.95[aout]`);

const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-stream_loop", "1", "-i", join(AUDIO, "musicPit.ogg"), "-i", join(AUDIO, "musicFight.ogg")];
for (const c of placed) args.push("-i", join(AUDIO, `${c.sfx}.wav`));
args.push("-filter_complex", filters.join(";"), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out);
const run = spawnSync(FFMPEG, args, { stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(`mixed ${out} with ${placed.length} cues`);
