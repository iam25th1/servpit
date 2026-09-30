// The trailer, as one deterministic timeline.
//
// Everything is placed by frame number. anime.js builds the timeline and is
// seeked to the frame's time, never played, and the fight and the slot machine
// are drawn by the game's own renderers stepped by a fixed 1000/30 ms a frame.
// No clock is read anywhere, so a render is the same every time.
//
// The cut is short on purpose: six seconds of a real round, then the numbers
// as they are, a screen at a time, then the lever. Text is Inter so it reads
// at a glance; the pixel art is the game's own, at whole number scales only,
// and nothing moves the frame.

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
import { AGENT_LINES, END, HASHES, MARROW_LINES, MEASURED, ODDS, RUN, SETTLE } from "./cut";

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

/** Landscape for the post, vertical for the phone. */
const V = new URLSearchParams(location.search).get("format") === "vertical";
const W = V ? 1080 : 1920;
const H = V ? 1920 : 1080;

/**
 * The stretches of the round shown, in round seconds: the six in which twenty
 * of its twenty three fall, then a hard cut to the last one and a bit, for the
 * blow that ends it. Nothing is sped up; the cut is the only edit.
 */
const FIGHT_CUTS = [{ from: 1.2, to: 7.2 }, { from: -1.2, to: 0 }];
/** Seconds between a screen's lines arriving. */
const STAGGER = 0.45;

const stage = document.getElementById("stage") as HTMLDivElement;
stage.style.width = `${W}px`;
stage.style.height = `${H}px`;
Object.entries(V
  ? { "--gutter": "72px", "--gap": "36px", "--head": "32px", "--text": "40px", "--num": "56px", "--note": "26px" }
  : { "--gutter": "200px", "--gap": "34px", "--head": "34px", "--text": "46px", "--num": "64px", "--note": "28px" },
).forEach(([k, v]) => stage.style.setProperty(k, v));

/** Sound cues, in seconds, for render.mjs to lay the pack's own sounds on. */
const BEATS: { at: number; sfx: string }[] = [];

// ================================================================ helpers
const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const round = (v: number): number => Math.round(v);
/** A hash as the screen shows it: the first ten and last eight characters. */
const shortHash = (url: string): string => { const h = url.slice(url.lastIndexOf("/") + 1); return `${h.slice(0, 10)}...${h.slice(-8)}`; };

function div(cls: string, parent: HTMLElement, html = ""): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

// Every element gets one animation carrying its whole life in keyframes.
// Separate in and out tweens on one element's opacity resolve in the wrong
// order when the timeline is seeked backwards.

/** Fades a whole scene in at a and out at b, in seconds. Null b: it stays. */
function sceneWindow(tl: AnimeTimeline, e: HTMLElement, a: number, b: number | null): void {
  const opacity: { from?: number; to: number; duration: number; delay?: number; ease: string }[] = [{ from: 0, to: 1, duration: 240, ease: "linear" }];
  if (b !== null) opacity.push({ to: 0, delay: (b - a) * 1000 - 480, duration: 240, ease: "linear" });
  tl.add(e, { opacity }, a * 1000);
}
/** Rises into place at `at` and stays. Opacity eases; the rise snaps to whole pixels. */
function show(tl: AnimeTimeline, e: HTMLElement, at: number, dist = 16): void {
  e.style.opacity = "0";
  tl.add(e, { opacity: { from: 0, to: 1, duration: 360, ease: "outCubic" }, translateY: { from: dist, to: 0, duration: 360, ease: "outCubic", modifier: round } }, at * 1000);
}

/** A number and what it counts, with an optional note under it saying where it is from. */
const line = (num: string, text: string, note = ""): string =>
  `<div class="line"><span class="num">${escape(num)}</span> ${escape(text)}${note ? `<div class="note">${escape(note)}</div>` : ""}</div>`;

// ================================================================ the fight
class Fight {
  readonly canvas: HTMLCanvasElement;
  private readonly timeline: Timeline;
  private juice!: Juice;
  private readonly renderer: ArenaRenderer;
  private readonly target: CanvasDrawTarget;
  private frame = -1;
  private cut = -1;
  /** Each cut in round milliseconds, and the clip frame it starts on. */
  private readonly cuts: { fromMs: number; firstFrame: number }[] = [];
  readonly clipFrames: number;

  constructor(private readonly store: AssetStore, private readonly round: RoundFile, private readonly standing: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "px";
    this.renderer = new ArenaRenderer(store, { arena: DEFAULT_ROUND.arena, floorSeed: round.roundId });
    this.target = new CanvasDrawTarget(this.canvas, this.renderer.width, this.renderer.height, (img) => store.whiteOf(img));
    this.target.setScale(2);
    const names: Record<string, string> = {};
    for (const d of round.decisions) if (d.entered) names[`agent-${d.agentId}`] = d.name;
    this.timeline = new Timeline({ log: round.log, characters: round.characters, names });
    this.timeline.onBatch((batch, silent) => this.juice.onBatch(batch, silent, (id) => this.timeline.actor(id)));
    let frames = 0;
    for (const c of FIGHT_CUTS) {
      const at = (s: number): number => (s <= 0 ? this.timeline.durationMs / 1000 + s : s);
      this.cuts.push({ fromMs: at(c.from) * 1000, firstFrame: frames });
      frames += Math.round((at(c.to) - at(c.from)) * FPS);
    }
    this.clipFrames = frames;
  }

  /** To the start of cut i, effects rebuilt on a fresh seed so a replay draws the same sparks. */
  private reset(i: number): void {
    const rng = createRng(`trailer-${this.round.roundId}`);
    const emitter = new ParticleEmitter(() => rng.nextU32() / 0x1_0000_0000);
    // The game's own effects, with every scale held at one: whole number scales only.
    const impactByTier = Object.fromEntries(Object.entries(DEFAULT_JUICE.impactByTier).map(([k, v]) => [k, { ...v, sheetScale: 1 }])) as typeof DEFAULT_JUICE.impactByTier;
    this.juice = new Juice(this.store, emitter, (x, y) => this.renderer.tileToPixel(x, y), { ...DEFAULT_JUICE, punchScale: 1, impactByTier });
    this.timeline.seek(this.cuts[i].fromMs);
    this.timeline.play();
    this.cut = i;
    this.frame = this.cuts[i].firstFrame;
  }

  /** Draws clip frame n, stepping from the last one; a jump backwards, or into another cut, starts that cut over. */
  draw(n: number): void {
    let i = this.cuts.length - 1;
    while (i > 0 && n < this.cuts[i].firstFrame) i--;
    if (i !== this.cut || n < this.frame) this.reset(i);
    while (this.frame < n) {
      if (!this.juice.frozen) this.timeline.advance(STEP);
      this.juice.advance(STEP);
      this.frame++;
    }
    const actors = this.timeline.actors();
    this.target.beginFrame();
    this.renderer.draw(this.target, { actors, timeMs: this.timeline.timeMs, fx: this.juice.actorFx(actors), drawEffects: (t) => this.juice.drawEffects(t) });
    this.standing.textContent = String(actors.filter((a) => a.alive).length);
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

  draw(timeMs: number, leverProgress: number): void {
    this.target.beginFrame();
    this.renderer.draw(this.target, { reels: this.reels.reelStates(), timeMs, leverProgress });
  }
}

// ================================================================ the cut
interface Built {
  tl: AnimeTimeline;
  fight: Fight;
  slot: Slot;
  fightPlay: number;
  fightEnd: number;
  afterFight: number;
  end: number;
  lever: number;
  duration: number;
}

async function build(): Promise<Built> {
  const manifest = parseManifest(await (await fetch("/assets/manifest.json")).json());
  const store = await loadAssets(manifest, createBrowserImageLoader());
  const roundFile = (await (await fetch("round.json")).json()) as RoundFile;
  const ui = (id: string): UiDef => { const u = manifest.ui.find((x) => x.id === id); if (!u) throw new Error(`no ui sprite ${id}`); return u; };
  const faceset = (character: string): string => manifest.entries.find((e) => e.id === character)?.facesetPath ?? `/assets/${character}/Faceset.png`;
  const marrowFace = manifest.portraits?.find((p) => /marrow/i.test(p.id))?.facesetPath ?? "/assets/Marrow/Faceset.png";
  const face = (src: string): string => `<div class="face" style="background-image:url(${ui("facesetBox").path})"><img src="${src}" alt=""></div>`;

  const tl = createTimeline({ autoplay: false });
  let t = 0;

  /** One screen: its items arrive one after another, it holds for `hold` seconds, and it fades. */
  const screen = (items: string[], hold: number, opts: { head?: string; itemSfx?: string } = {}): void => {
    const scene = div("scene", stage);
    const at = t;
    if (opts.head) show(tl, div("head", scene, escape(opts.head)), at + 0.1, 0);
    items.forEach((html, i) => {
      const when = at + 0.3 + i * STAGGER;
      show(tl, div("", scene, html), when);
      if (opts.itemSfx) BEATS.push({ at: when, sfx: opts.itemSfx });
    });
    if (!opts.itemSfx) BEATS.push({ at: at + 0.3, sfx: "uiSelect" });
    const len = 0.3 + (items.length - 1) * STAGGER + 0.36 + hold;
    sceneWindow(tl, scene, at, at + len);
    t = at + len;
  };

  // ------------------------------------------------------------ the fight
  const winner = roundFile.winner;
  const winnerName = roundFile.names[winner] ?? winner;
  const winnerChar = roundFile.characters.find((c) => c.entrantId === winner)?.characterId ?? "Hunter";
  const fightScene = div("scene", stage);
  fightScene.style.flexDirection = V ? "column" : "row";
  fightScene.style.alignItems = "center";
  fightScene.style.gap = V ? "48px" : "72px";
  const frame = div("", fightScene);
  Object.assign(frame.style, ninePatchStyle(ui("panelAlt"), 3));
  frame.style.padding = "6px";
  frame.style.flex = "none";
  const side = div("", fightScene);
  side.style.display = "flex";
  side.style.flexDirection = "column";
  side.style.gap = "28px";
  if (V) side.style.alignSelf = "stretch";
  side.innerHTML = `<div class="head">A real round, replayed from its seed</div><div class="line"><span class="num" id="standing">24</span> standing</div>`;
  const fight = new Fight(store, roundFile, side.querySelector("#standing") as HTMLElement);
  frame.appendChild(fight.canvas);
  const fightPlay = 0.4;
  const fightEnd = fightPlay + fight.clipFrames / FPS;
  const win = div("", side, `<div class="quote" style="align-items:center">${face(faceset(winnerChar))}<div><div class="line"><span class="num">${escape(winnerName)}</span> wins</div><div class="note">${roundFile.potChips} chips, the whole pot</div></div></div>`);
  show(tl, win, fightEnd + 0.2);
  BEATS.push({ at: fightEnd + 0.2, sfx: "winSting" });
  div("note", side, `round ${escape(roundFile.roundId)}`);
  t = fightEnd + 2.2;
  const afterFight = t;
  sceneWindow(tl, fightScene, 0, t);

  // ------------------------------------------------------------ six agents
  screen([
    `<div class="line"><span class="num">6</span> agents, <span class="num">6</span> wallets, nobody playing them</div>`,
    `<div style="display:flex;gap:24px;flex-wrap:wrap">${["Boy", "Hunter", "Knight", "NinjaRed", "NinjaBlue", "Caveman"].map((c) => face(faceset(c))).join("")}</div>`,
  ], 1.6);

  // ------------------------------------------------------------ SERV Reasoning, deciding
  const quote = (name: string, src: string, said: string, did: string, didClass: string, note: string): string =>
    `<div class="quote">${face(src)}<div><div class="who">${escape(name)}</div><div class="said">"${escape(said)}"</div><div class="did ${didClass}">${escape(did)}</div><div class="note">${escape(note)}</div></div></div>`;
  const vex = AGENT_LINES[0], rime = AGENT_LINES[1];
  screen([
    quote(vex.name, faceset(vex.face), vex.line, vex.said, "good", `live round ${vex.round}`),
    quote(rime.name, faceset(rime.face), rime.line, rime.said, "", `live round ${rime.round}`),
  ], 3.2, { head: "Each agent asks SERV Reasoning, every round: in or out" });
  const m0 = MARROW_LINES[0], m1 = MARROW_LINES[1];
  screen([
    quote("Marrow", marrowFace, m0.line, m0.said, "bad", m0.round),
    quote("Marrow", marrowFace, m1.line, m1.said, "good", `live round ${m1.round}, settled ${shortHash(HASHES[0].url)}`),
  ], 3.4, { head: "Marrow, the lender, asks it too" });

  // ------------------------------------------------------------ SERV, in numbers
  screen([
    line(RUN.servCalls, `SERV calls for ${RUN.servSpend}`, "from the SERV console, not the game's books"),
    line(RUN.perRound, "a round"),
    line(`${RUN.reasonedProven} proven + ${RUN.reasonedPulled} pulled`, "reasoned rounds"),
    line(RUN.failedInARow, `SERV calls failed in a row, ${RUN.roundsDropped} rounds dropped`),
    `<div class="line">${MEASURED.map((m) => escape(m).replace(/(\d+(?:\.\d+)?s|free)$/, '<span class="num">$1</span>')).join(", ")}, all measured</div>`,
  ], 3.0, { head: "SERV Reasoning" });

  // ------------------------------------------------------------ Base
  screen([
    ...HASHES.map((h) => `<div class="line">${escape(h.what)}<div class="note"><span class="amber">${shortHash(h.url)}</span>, live round ${escape(h.round)}</div></div>`),
    line(SETTLE.transfers, `transfers settled in ${SETTLE.seconds}`, `live round ${SETTLE.settleRound}`),
    line(SETTLE.gasEth, "gas", `one wallet's fee on the first settled round, from its receipt: ${SETTLE.gasWei} wei`),
  ], 3.0, { head: `Every chip settles on ${SETTLE.network}. Nobody signs anything.`, itemSfx: "payoutTransient" });
  screen([
    line(RUN.transfers, "transfers settled on chain"),
    line(RUN.chips, "chips moved"),
    line(RUN.reconFailures, `reconciliation failures, ${RUN.reconReal} of them real, every transfer correct to the wei`),
  ], 2.6);

  // ------------------------------------------------------------ the game, in numbers
  screen([
    line(RUN.rounds, "rounds played"),
    line(RUN.fightersPerRound, "fighters per round"),
    line(ODDS.ticks, `ticks a round on average, ${ODDS.seconds}`),
    line(RUN.survived, `rounds survived by one fighter, cupcake, with ${RUN.wins} wins`),
    line(RUN.kills, `kills, but only across ${RUN.claimedFighters} claimed fighters`),
    `<div class="line"><span class="num" style="color:var(--bad)">${escape(RUN.wrecked)}</span> agents wrecked</div>`,
  ], 3.0);
  const tier = (label: string, v: string, c: string): string => `<div style="color:${c}">${escape(label)}</div><div class="v">${escape(v)}</div>`;
  screen([
    line(ODDS.split, `rarity split, three of a kind on ${ODDS.tripleShare} of pulls`),
    `<div class="line" style="margin-bottom:12px">Measured win rates by tier, against a ${escape(ODDS.baseline)} baseline</div><div class="tiers">${tier("common", ODDS.common, "var(--tier-common)")}${tier("uncommon", ODDS.uncommon, "var(--tier-uncommon)")}${tier("rare", ODDS.rare, "var(--tier-rare)")}${tier("three of a kind", ODDS.triple, "var(--bone-bright)")}</div>`,
  ], 3.4);
  screen([
    line(`${RUN.days} days`, "running unattended"),
    line(RUN.spectators, "spectators held comfortably on a Mac mini"),
    line(RUN.tests, "tests"),
  ], 2.4);

  // ------------------------------------------------------------ the lever
  const end = t;
  const endScene = div("scene", stage);
  endScene.style.alignItems = "center";
  endScene.style.gap = "40px";
  const blazeReel = roundFile.reels.find((r) => r.entrantId === winner) ?? roundFile.reels[0];
  const probe = new SlotRenderer(store);
  const slotScale = Math.max(1, Math.floor(Math.min((V ? 960 : 900) / probe.width, (V ? 900 : 560) / probe.height)));
  const slot = new Slot(store, manifest, blazeReel.symbols, slotScale);
  endScene.appendChild(slot.canvas);
  const word = div("", endScene, `<div style="font-size:128px;font-weight:800;letter-spacing:0.06em;color:var(--amber);text-align:center;line-height:1">SERVPIT</div><div class="line" style="text-align:center;margin-top:20px">${escape(END.url)}</div>`);
  const lever = end + 0.7;
  show(tl, word, end + 2.0);
  BEATS.push({ at: lever, sfx: "leverPull" }, { at: end + 2.0, sfx: "jackpotSting" });
  // It ends on this card, held: no fade to black after it.
  sceneWindow(tl, endScene, end, null);
  const duration = Math.ceil((end + 5) * FPS) / FPS;

  return { tl, fight, slot, fightPlay, fightEnd, afterFight, end, lever, duration };
}

/** Lever travel at a time in seconds: down, held, back, once. */
function leverAt(b: Built, t: number): number {
  const a = b.lever;
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
  if (t < built.afterFight + 0.5) built.fight.draw(Math.max(0, Math.min(built.fight.clipFrames, Math.round((t - built.fightPlay) * FPS))));
  if (t >= built.end - 0.5) built.slot.draw(t * 1000, leverAt(built, t));
}

const ready = (async () => {
  built = await build();
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
  window.TRAILER.frames = Math.round(built.duration * FPS);
  renderFrame(0);
})();

declare global {
  interface Window {
    TRAILER: { ready: Promise<void>; fps: number; frames: number; width: number; height: number; renderFrame: (n: number) => void; cues: () => Record<string, number>; beats: () => { at: number; sfx: string }[] };
  }
}
window.TRAILER = {
  ready,
  fps: FPS,
  frames: 0,
  width: W,
  height: H,
  renderFrame,
  // For the audio: when each thing happens, in seconds. `six` is where the
  // fight music hands over to the pit music.
  cues: () => (built ? { fightEnd: built.fightEnd, six: built.afterFight, end: built.end, lever: built.lever, duration: built.duration } : ({} as Record<string, number>)),
  beats: () => [...BEATS].sort((a, b) => a.at - b.at),
};
