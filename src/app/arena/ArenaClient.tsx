"use client";

// Demo page: resolves a seeded round in the browser and replays it through
// the render core. Demo only. Production resolves rounds on the server and
// ships the client a log; nothing here touches money.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DEFAULT_ROUND } from "@/config/round";
import { resolveRound } from "@/engine/resolveRound";
import { createRng } from "@/engine/rng";
import { ArenaRenderer } from "@/render/arena";
import { loadAssets, type AssetStore } from "@/render/assets";
import { createBrowserImageLoader } from "@/render/browserImages";
import { CanvasDrawTarget, computeIntegerScale } from "@/render/draw";
import { ParticleEmitter } from "@/render/emitter";
import { Juice } from "@/render/juice";
import { startLoop } from "@/render/loop";
import { parseManifest } from "@/render/manifest";
import { Timeline } from "@/render/timeline";
import styles from "./arena.module.css";

type Status = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

interface View {
  tick: number;
  lastTick: number;
  alive: number;
  timeMs: number;
  durationMs: number;
  playing: boolean;
  finished: boolean;
}

const SPEEDS = [0.5, 1, 2] as const;
const MAX_SCALE = 3;

export function ArenaClient({ seed, entrants }: { seed: string; entrants: number }) {
  const router = useRouter();
  const round = useMemo(
    () => resolveRound(seed, Array.from({ length: entrants }, (_, i) => ({ id: `p${i}` })), DEFAULT_ROUND),
    [seed, entrants],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const juiceRef = useRef<Juice | null>(null);
  const speedRef = useRef(1);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [store, setStore] = useState<AssetStore | null>(null);
  const [view, setView] = useState<View>({ tick: 0, lastTick: 0, alive: entrants, timeMs: 0, durationMs: 1, playing: false, finished: false });
  const [speed, setSpeed] = useState<number>(1);
  const [seedInput, setSeedInput] = useState(seed);
  const [entrantsInput, setEntrantsInput] = useState(String(entrants));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/assets/manifest.json");
        if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
        const manifest = parseManifest(await response.json());
        const loaded = await loadAssets(manifest, createBrowserImageLoader());
        if (!cancelled) {
          setStore(loaded);
          setStatus({ kind: "ready" });
        }
      } catch (e) {
        if (!cancelled) setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!store || !canvas || !frame) return;

    const renderer = new ArenaRenderer(store, { arena: DEFAULT_ROUND.arena });
    const target = new CanvasDrawTarget(canvas, renderer.width, renderer.height, (image) => store.whiteOf(image));
    const timeline = new Timeline(round);
    const fxRng = createRng(`${seed}:fx`);
    const emitter = new ParticleEmitter(() => fxRng.nextU32() / 0x1_0000_0000);
    const juice = new Juice(store, emitter, (x, y) => renderer.tileToPixel(x, y));
    timeline.onBatch((batch, silent) => juice.onBatch(batch, silent, (id) => timeline.actor(id)));
    timelineRef.current = timeline;
    juiceRef.current = juice;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) timeline.play();

    const fit = (): void => {
      const scale = computeIntegerScale(frame.clientWidth, Math.max(renderer.height, window.innerHeight - 200), renderer.width, renderer.height);
      target.setScale(Math.min(MAX_SCALE, scale));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);

    let published = "";
    const loop = startLoop((deltaMs) => {
      const dt = deltaMs * speedRef.current;
      if (!juice.frozen) timeline.advance(dt);
      juice.update(dt);
      juice.frame();
      const actors = timeline.actors();
      target.beginFrame();
      renderer.draw(target, { actors, timeMs: timeline.timeMs, fx: juice.actorFx(actors), drawEffects: (t) => juice.drawEffects(t) });
      const key = `${Math.floor(timeline.timeMs / 50)}:${timeline.playing}:${timeline.finished}`;
      if (key !== published) {
        published = key;
        setView({
          tick: timeline.tick,
          lastTick: timeline.lastTick,
          alive: actors.filter((a) => a.alive).length,
          timeMs: timeline.timeMs,
          durationMs: timeline.durationMs,
          playing: timeline.playing,
          finished: timeline.finished,
        });
      }
    });

    return () => {
      loop.stop();
      observer.disconnect();
      timelineRef.current = null;
      juiceRef.current = null;
    };
  }, [store, round, seed]);

  const replay = (): void => {
    juiceRef.current?.reset();
    timelineRef.current?.restart();
  };

  const togglePlay = (): void => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    if (timeline.playing) timeline.pause();
    else timeline.play();
  };

  const scrub = (ms: number): void => {
    juiceRef.current?.reset();
    timelineRef.current?.seek(ms);
  };

  const loadRound = (event: FormEvent): void => {
    event.preventDefault();
    router.push(`/arena?seed=${encodeURIComponent(seedInput)}&entrants=${encodeURIComponent(entrantsInput)}`);
  };

  const winnerId = round.placements[0];
  const winner = round.characters.find((c) => c.entrantId === winnerId);
  const prize = round.payouts.find((p) => p.entrantId === winnerId)?.amount ?? 0;
  const lastTick = round.log[round.log.length - 1].t;

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>servpit</h1>
        <p className={styles.facts}>
          Round {seed}, {entrants} entrants, {round.log.length} events over {lastTick} ticks.
        </p>
      </header>

      <div ref={frameRef} className={styles.frame}>
        <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={`Arena replay of round ${seed}`} />
        {status.kind === "loading" && <p className={styles.notice}>Loading sprites</p>}
        {status.kind === "error" && (
          <p className={styles.error} role="alert">
            Sprites failed to load. {status.message}
          </p>
        )}
      </div>

      <section className={styles.controls} aria-label="Playback">
        <button type="button" onClick={replay} disabled={status.kind !== "ready"}>
          Replay
        </button>
        <button type="button" onClick={togglePlay} disabled={status.kind !== "ready"}>
          {view.playing ? "Pause" : view.finished ? "Play again" : "Play"}
        </button>
        <label className={styles.scrub}>
          Scrub
          <input type="range" min={0} max={view.durationMs} step={10} value={view.timeMs} onChange={(e) => scrub(Number(e.target.value))} disabled={status.kind !== "ready"} />
        </label>
        <label>
          Speed{" "}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
        <p className={styles.status} aria-live="polite">
          Tick {view.tick} of {view.lastTick}, {view.alive} standing.
          {view.finished && winner ? ` ${winnerId} wins as ${winner.characterId} (${winner.tier}) and takes ${prize} of the ${round.pot} pot.` : ""}
        </p>
      </section>

      <form className={styles.pick} onSubmit={loadRound}>
        <label>
          Seed
          <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} maxLength={64} pattern="[A-Za-z0-9_-]{1,64}" required />
        </label>
        <label>
          Entrants
          <input type="number" min={16} max={32} value={entrantsInput} onChange={(e) => setEntrantsInput(e.target.value)} required />
        </label>
        <button type="submit">Load round</button>
      </form>

      <p className={styles.footnote}>
        Demo only. This page resolves the round in the browser so it can be replayed from any seed. In production the server resolves the round and the client only replays the log it is given.
      </p>
    </main>
  );
}
