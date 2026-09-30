// The trailer, as one deterministic timeline.
//
// Everything is placed by frame number. anime.js builds the timeline and is
// seeked to the frame's time, never played, and the fight and the slot machine
// are drawn by the game's own renderers stepped by a fixed 1000/30 ms a frame.
// No clock is read anywhere, so a render is the same every time.
//
// The house look, as rules: the game's palette, its two pixel fonts at
// multiples of eight, its nine-patch panels at a whole number scale, pixel art
// at whole number scales only, and nothing that moves the frame. Elements come
// and go; the camera does not exist.

import { createTimeline, type Timeline as AnimeTimeline } from "animejs";
import { DEFAULT_ROUND } from "@/config/round";
import { DEFAULT_SLOT } from "@/config/slot";
import type { Combatant } from "@/engine/combat";
import type { RoundEvent } from "@/engine/events";
import { createRng } from "@/engine/rng";
import { ArenaRenderer } from "@/render/arena";
import { loadAssets, type AssetStore } from "@/render/assets";
import { createBrowserImageLoader } from "@/render/browserImages";
import { CanvasDrawTarget } from "@/render/draw";
import { ParticleEmitter } from "@/render/emitter";
import { DEFAULT_JUICE, Juice } from "@/render/juice";
import { parseManifest, type Manifest, type UiDef } from "@/render/manifest";
import { SlotRenderer } from "@/render/slot/draw";
import { ReelSet } from "@/render/slot/reels";
import { Timeline } from "@/render/timeline";
import { ninePatchStyle } from "@/ui/ninePatchGeometry";
import { AGENT_LINES, END, HASHES, MARROW_LINES, MEASURED, ODDS, RUN, SETTLE, FIGHT } from "./cut";

export const FPS = 30;
const STEP = 1000 / FPS;

interface RoundFile {
  roundId: string;
  winner: string;
  potChips: number;
  names: Record<string, string>;
  decisions: { agentId: string; name: string; entered: boolean }[];
  characters: Combatant[];
  placements: string[];
  reels: { entrantId: string; symbols: [string, string, string]; characterId: string }[];
  log: RoundEvent[];
}

/** Landscape for the post, vertical for the phone. Everything is laid out from these. */
const FORMAT = new URLSearchParams(location.search).get("format") === "vertical" ? "vertical" : "landscape";
const W = FORMAT === "vertical" ? 1080 : 1920;
const H = FORMAT === "vertical" ? 1920 : 1080;
const V = FORMAT === "vertical";

// ================================================================ the cut
// Seconds. The fight runs on its own clock inside FIGHT_AT to FIGHT_END.
// Each section starts where the one before it ends; build() checks the fight
// ends in time for its winner to be read before the cut.
const T = {
  fightAt: 1.2,
  win: 0,
  six: 17.4,
  serv: 20.6,
  base: 52.0,
  numbers: 66.0,
  end: 84.8,
  duration: 90,
};

// ================================================================ helpers
const stage = document.getElementById("stage") as HTMLDivElement;
stage.style.width = `${W}px`;
stage.style.height = `${H}px`;

function el(cls: string, parent: HTMLElement = stage, html = ""): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  e.innerHTML = html;
  e.style.opacity = "0";
  parent.appendChild(e);
  return e;
}
function place(e: HTMLElement, x: number, y: number, w?: number): HTMLElement {
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
  if (w !== undefined) e.style.width = `${w}px`;
  return e;
}
function nine(e: HTMLElement, def: UiDef, scale: number): void {
  Object.assign(e.style, ninePatchStyle(def, scale));
}
const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
/** A hash as the screen shows it: the first ten and last eight characters. */
const shortHash = (url: string): string => { const h = url.slice(url.lastIndexOf("/") + 1); return `${h.slice(0, 10)}...${h.slice(-8)}`; };
const round = (v: number): number => Math.round(v);

// ================================================================ build
interface Built {
  tl: AnimeTimeline;
  fight: Fight;
  slot: Slot;
}

/**
 * A figure as the screen shows it: the number in the display face, the words
 * after it in the UI face. The display face is the game's wordmark face and,
 * as in the game, it carries numerals and capitals only: it has no space.
 */
function figureHtml(num: string, rest: string, small: string, size = V ? "t64" : "t96"): string {
  const words = rest ? `<span class="${size}"> ${escape(rest)}</span>` : "";
  return `<div class="amber"><span class="display ${size}">${escape(num)}</span>${words}</div><div class="t32" style="margin-top:24px">${escape(small)}</div>`;
}

/**
 * Lays items end to end from a, each held for its own time, and checks the
 * last one is gone by b: sections cannot overrun each other.
 */
function inTurn<X extends { hold: number }>(a: number, b: number, items: X[]): (X & { at: number; until: number })[] {
  let t = a;
  const out = items.map((x) => { const at = t; t += x.hold; return { ...x, at, until: t }; });
  if (t > b + 1e-6) throw new Error(`section from ${a}s runs to ${t}s, past ${b}s`);
  return out;
}

/** Fades a whole scene in at a and out at b, in seconds. */
function sceneWindow(tl: AnimeTimeline, e: HTMLElement, a: number, b: number): void {
  tl.add(e, { opacity: [0, 1], duration: 240, ease: "linear" }, a * 1000);
  tl.add(e, { opacity: [1, 0], duration: 240, ease: "linear" }, b * 1000 - 240);
}
/** A line that rises into place and stays for its scene. Whole pixels only. */
function rise(tl: AnimeTimeline, e: HTMLElement, at: number, dist = 24): void {
  tl.add(e, { opacity: [0, 1], translateY: [dist, 0], duration: 420, ease: "outCubic", modifier: round }, at * 1000);
}
function out(tl: AnimeTimeline, e: HTMLElement, at: number): void {
  tl.add(e, { opacity: [1, 0], duration: 240, ease: "linear" }, at * 1000);
}

class Fight {
  readonly canvas: HTMLCanvasElement;
  private readonly timeline: Timeline;
  private readonly juice: Juice;
  private readonly renderer: ArenaRenderer;
  private readonly target: CanvasDrawTarget;
  private readonly feed: string[] = [];
  private frame = -1;
  readonly durationMs: number;

  constructor(private readonly store: AssetStore, private readonly round: RoundFile, private readonly standing: HTMLElement, private readonly feedEl: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "px";
    this.renderer = new ArenaRenderer(store, { arena: DEFAULT_ROUND.arena, floorSeed: round.roundId });
    this.target = new CanvasDrawTarget(this.canvas, this.renderer.width, this.renderer.height, (img) => store.whiteOf(img));
    this.target.setScale(2);
    const names: Record<string, string> = {};
    for (const d of round.decisions) if (d.entered) names[`agent-${d.agentId}`] = d.name;
    this.timeline = new Timeline({ log: round.log, characters: round.characters, names });
    // The game's own effects, with every scale held at one: pixel art is
    // drawn at whole number scales only in this piece.
    const rng = createRng(`trailer-${round.roundId}`);
    const emitter = new ParticleEmitter(() => rng.nextU32() / 0x1_0000_0000);
    const impactByTier = Object.fromEntries(Object.entries(DEFAULT_JUICE.impactByTier).map(([k, v]) => [k, { ...v, sheetScale: 1 }])) as typeof DEFAULT_JUICE.impactByTier;
    this.juice = new Juice(store, emitter, (x, y) => this.renderer.tileToPixel(x, y), { ...DEFAULT_JUICE, punchScale: 1, impactByTier });
    this.timeline.onBatch((batch, silent) => {
      this.juice.onBatch(batch, silent, (id) => this.timeline.actor(id));
      for (const ev of batch.events ?? []) if (ev.type === "death") this.feed.push(ev.actor);
    });
    this.durationMs = this.timeline.durationMs;
    this.reset();
  }

  private reset(): void {
    this.timeline.seek(0);
    this.juice.reset();
    this.feed.length = 0;
    this.frame = -1;
  }

  private label(id: string): string {
    const d = this.round.decisions.find((x) => `agent-${x.agentId}` === id);
    if (d) return d.name;
    const m = /^bot-(\d+)$/.exec(id);
    return m ? `House ${Number(m[1]) + 1}` : id;
  }

  /** Draws fight frame n, stepping from the last one; a jump backwards replays from the start. */
  draw(n: number): void {
    if (n < this.frame) this.reset();
    if (this.frame < 0) { this.timeline.play(); this.frame = 0; }
    while (this.frame < n) {
      if (!this.juice.frozen) this.timeline.advance(STEP);
      this.juice.advance(STEP);
      this.frame++;
    }
    const actors = this.timeline.actors();
    this.target.beginFrame();
    this.renderer.draw(this.target, { actors, timeMs: this.timeline.timeMs, fx: this.juice.actorFx(actors), drawEffects: (t) => this.juice.drawEffects(t) });
    const alive = actors.filter((a) => a.alive).length;
    this.standing.textContent = String(alive);
    const lines = this.feed.map((id) => `${this.round.placements.indexOf(id) + 1}. ${escape(this.label(id))} is out`);
    this.feedEl.innerHTML = lines.slice(-9).map((l, i, all) => `<div style="opacity:${i === all.length - 1 ? 1 : 0.62}">${l}</div>`).join("");
  }
}

class Slot {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: SlotRenderer;
  private readonly target: CanvasDrawTarget;
  private readonly reels: ReelSet;

  constructor(store: AssetStore, manifest: Manifest, symbols: [string, string, string], readonly scale: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "px";
    this.renderer = new SlotRenderer(store);
    this.target = new CanvasDrawTarget(this.canvas, this.renderer.width, this.renderer.height, (img) => store.whiteOf(img));
    this.target.setScale(scale);
    // Landed, on the round's own draw. Spinning reels smear, which is motion
    // blur, so they are only ever shown stopped.
    this.reels = new ReelSet(DEFAULT_SLOT, manifest.entries.map((e) => e.id));
    this.reels.start(symbols, 1);
    for (let i = 0; i < 2000 && !this.reels.settled; i++) this.reels.advance(STEP);
  }

  get width(): number { return this.renderer.width * this.scale; }
  get height(): number { return this.renderer.height * this.scale; }

  draw(timeMs: number, leverProgress: number): void {
    this.target.beginFrame();
    this.renderer.draw(this.target, { reels: this.reels.reelStates(), timeMs, leverProgress });
  }
}

async function build(): Promise<Built> {
  const manifest = parseManifest(await (await fetch("/assets/manifest.json")).json());
  const store = await loadAssets(manifest, createBrowserImageLoader());
  const roundFile = (await (await fetch("round.json")).json()) as RoundFile;
  const ui = (id: string): UiDef => { const u = manifest.ui.find((x) => x.id === id); if (!u) throw new Error(`no ui sprite ${id}`); return u; };
  const faceset = (character: string): string => manifest.entries.find((e) => e.id === character)?.facesetPath ?? `/assets/${character}/Faceset.png`;
  const marrowFace = manifest.portraits?.find((p) => /marrow/i.test(p.id))?.facesetPath ?? "/assets/Marrow/Faceset.png";
  const facebox = (src: string, x: number, y: number, parent: HTMLElement): HTMLElement => {
    const b = el("facebox", parent, `<img src="${src}" alt="">`);
    b.style.backgroundImage = `url(${ui("facesetBox").path})`;
    b.style.opacity = "1";
    return place(b, x, y);
  };
  const parchment = (parent: HTMLElement, x: number, y: number, html: string): HTMLElement => {
    const p = el("parchment t32", parent, html);
    p.style.backgroundImage = `url(${ui("dialogSimple").path})`;
    p.style.opacity = "1";
    return place(p, x, y);
  };

  const tl = createTimeline({ autoplay: false });

  // ------------------------------------------------------------ the fight
  const fightScene = el("scene");
  const frame = el("nine", fightScene);
  nine(frame, ui("panelAlt"), 3);
  frame.style.opacity = "1";
  frame.style.padding = "6px";
  const ax = V ? 108 : 120, ay = V ? 150 : 104;
  place(frame, ax, ay);
  const side = el("nine", fightScene);
  nine(side, ui("bg"), 3);
  side.style.opacity = "1";
  side.style.padding = "22px 26px";
  if (V) { place(side, 108, 1080, 864); side.style.height = "560px"; } else { place(side, 1028 + 64, 104, 700); side.style.height = "872px"; }
  side.innerHTML = `
    <div class="t48" style="color:var(--bone-bright)">The pit</div>
    <div class="row t32" style="margin-top:24px"><span>Standing</span><span id="standing" class="amber" style="margin-left:auto">24</span></div>
    <div class="row t32" style="margin-top:8px"><span>Paid in</span><span class="amber" style="margin-left:auto">${roundFile.decisions.filter((d) => d.entered).length} agents</span></div>
    <div id="feed" class="t24 dim" style="margin-top:28px;line-height:40px"></div>`;
  const fight = new Fight(store, roundFile, side.querySelector("#standing") as HTMLElement, side.querySelector("#feed") as HTMLElement);
  frame.appendChild(fight.canvas);
  const fightEnd = T.fightAt + fight.durationMs / 1000;
  T.win = fightEnd + 0.4;
  if (T.win + 2.4 > T.six) throw new Error(`the fight ends at ${fightEnd}s, too late for its winner to hold before ${T.six}s`);
  const caption = el("abs t24 dim", fightScene, `${escape(FIGHT.caption)}, round ${roundFile.roundId}`);
  place(caption, ax, V ? 994 : 1000);
  caption.style.opacity = "1";
  sceneWindow(tl, fightScene, 0.2, T.six);
  // The winner, on the side panel, once the last one is standing.
  const winner = roundFile.winner;
  const winnerName = roundFile.names[winner] ?? winner;
  const winnerChar = roundFile.characters.find((c) => c.entrantId === winner)?.characterId ?? "Hunter";
  const win = el("abs", fightScene);
  if (V) place(win, 108, 1700, 864); else place(win, 1092, 700, 700);
  facebox(faceset(winnerChar), 0, 0, win);
  const winText = el("abs", win, `<div class="t64 amber">${escape(winnerName)} wins</div><div class="t32" style="margin-top:8px">${roundFile.potChips} chips, the whole pot</div>`);
  place(winText, 176, 8);
  winText.style.opacity = "1";
  rise(tl, win, T.win);

  // ------------------------------------------------------------ six agents
  const six = el("scene");
  const sixHead = el("abs center " + (V ? "t64" : "t96"), six, "Six agents.<br>Six wallets.");
  place(sixHead, 0, V ? 520 : 220, W);
  const sixSub = el("abs center t48 amber", six, "Nobody playing them.");
  place(sixSub, 0, V ? 760 : 470, W);
  const faces = ["Boy", "Hunter", "Knight", "NinjaRed", "NinjaBlue", "Caveman"];
  faces.forEach((f, i) => {
    const b = facebox(faceset(f), 0, 0, six);
    const perRow = V ? 3 : 6, gap = V ? 184 : 184;
    const x0 = (W - (perRow * 144 + (perRow - 1) * (gap - 144))) / 2;
    place(b, x0 + (i % perRow) * gap, (V ? 960 : 640) + Math.floor(i / perRow) * 184);
    b.style.opacity = "0";
    rise(tl, b, T.six + 1.0 + i * 0.12, 16);
  });
  rise(tl, sixHead, T.six + 0.1);
  rise(tl, sixSub, T.six + 0.7);
  sceneWindow(tl, six, T.six, T.serv);

  // ------------------------------------------------------------ SERV deciding
  const serv = el("scene");
  const servHead = el("abs center t48", serv, `Every round, each one asks <span class="amber">SERV Reasoning</span>: in or out.`);
  place(servHead, V ? 60 : 0, V ? 200 : 110, V ? W - 120 : W);
  rise(tl, servHead, T.serv + 0.1);
  const px0 = (W - 948) / 2 + (V ? 0 : 88);
  const quote = (name: string, face: string, line: string, said: string, where: string, at: number, until: number, saidClass: string): void => {
    const g = el("abs", serv);
    place(g, 0, 0);
    g.style.width = `${W}px`;
    const fy = V ? 700 : 380;
    facebox(face, V ? (W - 144) / 2 : px0 - 176, V ? fy - 190 : fy + 18, g);
    parchment(g, px0 - (V ? 0 : 0), fy, `<div><div class="t24" style="color:var(--ink-dim)">${escape(name)}</div><div class="t32">"${escape(line)}"</div></div>`);
    const s = el("abs t48 " + saidClass, g, escape(said));
    place(s, V ? 0 : px0, fy + 216, V ? W : 948);
    if (V) s.classList.add("center");
    s.style.opacity = "1";
    const w = el("abs t16 dim", g, escape(where));
    place(w, V ? 0 : px0, fy + 284, V ? W : 948);
    if (V) w.classList.add("center");
    w.style.opacity = "1";
    rise(tl, g, at, 16);
    out(tl, g, until - 0.25);
  };
  const vex = AGENT_LINES[0], rime = AGENT_LINES[1];
  quote(vex.name, faceset(vex.face), vex.line, vex.said, `live round ${vex.round}, answered by SERV`, T.serv + 1.0, T.serv + 5.4, "good");
  quote(rime.name, faceset(rime.face), rime.line, rime.said, `live round ${rime.round}, answered by SERV`, T.serv + 5.4, T.serv + 9.8, "dim");
  const lenderHead = el("abs center t48", serv, `And the lender, <span class="amber">Marrow</span>, asks it too.`);
  place(lenderHead, V ? 60 : 0, V ? 200 : 110, V ? W - 120 : W);
  out(tl, servHead, T.serv + 9.6);
  rise(tl, lenderHead, T.serv + 9.9);
  const m0 = MARROW_LINES[0], m1 = MARROW_LINES[1];
  quote("Marrow", marrowFace, m0.line, m0.said, `${m0.round}, answered by SERV`, T.serv + 10.2, T.serv + 14.6, "bad");
  quote("Marrow", marrowFace, m1.line, m1.said, `live round ${m1.round}, answered by SERV, settled ${shortHash(HASHES[0].url)}`, T.serv + 14.6, T.serv + 19.4, "good");
  out(tl, lenderHead, T.serv + 19.2);
  // SERV's own figures, one at a time.
  const servFigures = inTurn(T.serv + 19.4, T.base, [
    { html: figureHtml(RUN.servCalls, `SERV calls, ${RUN.servSpend}`, "from the SERV console, not the game's books"), hold: 2.6 },
    { html: figureHtml(RUN.perRound, "a round", "SERV console"), hold: 1.8 },
    { html: figureHtml(`${RUN.reasonedProven} + ${RUN.reasonedPulled}`, "reasoned rounds", `${RUN.reasonedProven} proven, ${RUN.reasonedPulled} pulled`), hold: 2.4 },
    { html: figureHtml(RUN.failedInARow, "SERV calls failed in a row.", `${RUN.roundsDropped} rounds dropped.`), hold: 2.4 },
    { html: `<div class="amber ${V ? "t48" : "t64"}">${MEASURED.map(escape).join("<br>")}</div><div class="t32" style="margin-top:24px">all measured</div>`, hold: 2.8 },
  ]);
  for (const f of servFigures) {
    const g = el("abs center", serv, f.html);
    place(g, V ? 60 : 80, V ? 780 : 420, W - (V ? 120 : 160));
    rise(tl, g, f.at);
    out(tl, g, f.until - 0.25);
  }
  sceneWindow(tl, serv, T.serv, T.base);

  // ------------------------------------------------------------ Base
  const base = el("scene");
  const baseHead = el("abs center t48", base, `Every chip moves on <span class="amber">${escape(SETTLE.network)}</span>.<br>Nobody signs anything.`);
  place(baseHead, V ? 60 : 0, V ? 200 : 96, V ? W - 120 : W);
  rise(tl, baseHead, T.base + 0.1);
  const rowsTop = V ? 520 : 290;
  HASHES.forEach((h, i) => {
    const r = el("nine", base);
    nine(r, ui("bg"), 3);
    r.style.padding = "18px 24px";
    place(r, V ? 60 : 280, rowsTop + i * (V ? 190 : 150), V ? W - 120 : 1360);
    r.innerHTML = `<div class="row t32"><span>${escape(h.what)}</span></div><div class="row t24" style="margin-top:6px"><span class="amber">${shortHash(h.url)}</span><span class="dim">live round ${escape(h.round)}</span></div>`;
    rise(tl, r, T.base + 1.2 + i * 1.2, 16);
    out(tl, r, T.base + 6.6);
  });
  const baseFigures = inTurn(T.base + 6.8, T.numbers, [
    { html: figureHtml(SETTLE.transfers, `transfers. ${SETTLE.seconds}.`, `one live round, ${SETTLE.settleRound}, settling`), hold: 2.4 },
    { html: figureHtml(SETTLE.gasEth, "", `gas: a wallet's fee on the first settled round, from its receipt, ${SETTLE.gasWei} wei`, V ? "t48" : "t64"), hold: 2.4 },
    { html: figureHtml(RUN.transfers, "transfers settled on chain", `${RUN.chips} chips moved`), hold: 2.4 },
  ]);
  for (const f of baseFigures) {
    const g = el("abs center", base, f.html);
    place(g, V ? 60 : 80, V ? 780 : 420, W - (V ? 120 : 160));
    rise(tl, g, f.at);
    out(tl, g, f.until - 0.25);
  }
  out(tl, baseHead, T.base + 6.5);
  const reconHead = el("abs center t48", base, `${RUN.reconFailures} reconciliation failures. <span class="good">${RUN.reconReal} of them real.</span><br>Every transfer correct to the wei.`);
  place(reconHead, V ? 60 : 0, V ? 200 : 96, V ? W - 120 : W);
  rise(tl, reconHead, T.base + 6.8);
  sceneWindow(tl, base, T.base, T.numbers);

  // ------------------------------------------------------------ the run, one number at a time
  const nums = el("scene");
  const tierRow = (label: string, v: string, c: string): string => `<div class="row t48"><span style="color:${c};width:50%;text-align:right">${label}</span><span style="width:50%;text-align:left">${v}</span></div>`;
  const runFigures = inTurn(T.numbers, T.end, [
    { html: `<div class="display t128 amber">${RUN.rounds}</div><div class="t48">rounds played</div>`, hold: 1.9 },
    { html: `<div class="display t128 amber">${RUN.fightersPerRound}</div><div class="t48">fighters per round</div>`, hold: 1.7 },
    { html: `<div class="display t128 amber">${RUN.survived}</div><div class="t48">rounds survived by one fighter, cupcake. ${RUN.wins} wins.</div><div class="t32 dim" style="margin-top:16px">${RUN.kills} kills, but only across ${RUN.claimedFighters} claimed fighters</div>`, hold: 2.8 },
    { html: `<div class="display t128 bad">${RUN.wrecked}</div><div class="t48">agents wrecked</div>`, hold: 1.8 },
    { html: `<div class="display t128 amber">${ODDS.split}</div><div class="t48">rarity split. Three of a kind on ${ODDS.tripleShare} of pulls.</div>`, hold: 2.1 },
    { html: `<div class="t48" style="margin-bottom:24px">Measured win rates, against a ${ODDS.baseline} baseline</div>${tierRow("common", ODDS.common, "var(--tier-common)")}${tierRow("uncommon", ODDS.uncommon, "var(--tier-uncommon)")}${tierRow("rare", ODDS.rare, "var(--tier-rare)")}${tierRow("three of a kind", ODDS.triple, "var(--bone-bright)")}`, hold: 3.0 },
    { html: `<div class="amber"><span class="display t128">${ODDS.ticks}</span><span class="t96"> ticks</span></div><div class="t48">a round, on average. ${ODDS.seconds}.</div>`, hold: 1.9 },
    { html: `<div class="amber"><span class="display t128">${RUN.days}</span><span class="t96"> days</span></div><div class="t48">running unattended. ${RUN.spectators} spectators held comfortably on a Mac mini.</div>`, hold: 2.1 },
    { html: `<div class="display t128 amber">${RUN.tests}</div><div class="t48">tests</div>`, hold: 1.5 },
  ]);
  for (const f of runFigures) {
    const g = el("abs center", nums, f.html);
    place(g, V ? 60 : 120, V ? 720 : 330, W - (V ? 120 : 240));
    rise(tl, g, f.at + 0.1);
    out(tl, g, f.until - 0.25);
  }
  sceneWindow(tl, nums, T.numbers, T.end);

  // ------------------------------------------------------------ the lever
  const endScene = el("scene");
  const blazeReel = roundFile.reels.find((r) => r.entrantId === winner) ?? roundFile.reels[0];
  const probe = new SlotRenderer(store);
  const slotScale = Math.max(1, Math.floor(Math.min((V ? 960 : 900) / probe.width, (V ? 900 : 560) / probe.height)));
  const slot = new Slot(store, manifest, blazeReel.symbols, slotScale);
  const slotBox = el("abs", endScene);
  slotBox.style.opacity = "1";
  slotBox.appendChild(slot.canvas);
  // Slot, gap, wordmark (136) and address (16 + 56), centred as one block.
  const endTop = Math.round((H - (slot.height + 40 + 136 + 72)) / 2);
  place(slotBox, Math.round((W - slot.width) / 2), endTop);
  const word = el("abs center", endScene, `<div class="display t128 amber">SERVPIT</div><div class="t48" style="margin-top:16px">${escape(END.url)}</div>`);
  place(word, 0, endTop + slot.height + 40, W);
  rise(tl, word, T.end + 2.0);
  // It ends on this card, held: no fade to black after it.
  tl.add(endScene, { opacity: [0, 1], duration: 240, ease: "linear" }, T.end * 1000);

  return { tl, fight, slot };
}

/** Lever travel at a time in seconds: down, held, back, once. */
function lever(t: number): number {
  const a = T.end + 0.7;
  if (t < a) return 0;
  if (t < a + 0.35) return (t - a) / 0.35;
  if (t < a + 0.8) return 1;
  if (t < a + 1.3) return 1 - (t - a - 0.8) / 0.5;
  return 0;
}

let built: Built | null = null;

/** Draws frame n. Frames can be asked for in any order; in order is fastest. */
function renderFrame(n: number): void {
  if (!built) throw new Error("not ready");
  const t = n / FPS;
  built.tl.seek(t * 1000);
  const fightFrame = Math.max(0, Math.round((t - T.fightAt) * FPS));
  if (t < T.six + 0.5) built.fight.draw(fightFrame);
  if (t >= T.end - 0.5) built.slot.draw(t * 1000, lever(t));
}

const ready = (async () => {
  built = await build();
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
  renderFrame(0);
})();

declare global {
  interface Window {
    TRAILER: { ready: Promise<void>; fps: number; frames: number; width: number; height: number; renderFrame: (n: number) => void; cues: () => Record<string, number> };
  }
}
window.TRAILER = {
  ready,
  fps: FPS,
  frames: T.duration * FPS,
  width: W,
  height: H,
  renderFrame,
  // For the audio: when each thing happens, in seconds.
  cues: () => ({ fightAt: T.fightAt, win: T.win, six: T.six, serv: T.serv, base: T.base, numbers: T.numbers, end: T.end, lever: T.end + 0.7, word: T.end + 2.0, duration: T.duration }),
};
