"use client";

// The player flow. One machine decides the screen, one loop drives every
// animation on the page, and the loop is started once and never restarted, so
// moving from the slot to the arena does not reset the clock or reload
// anything. Both canvases stay mounted; only their visibility changes.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { GAME_MODES, type StakeTierId } from "@/config/modes";
import { DEFAULT_ROUND } from "@/config/round";
import { DEFAULT_SLOT } from "@/config/slot";
import { createRng } from "@/engine/rng";
import { ArenaRenderer } from "@/render/arena";
import { loadAssets, type AssetStore } from "@/render/assets";
import { createBrowserImageLoader } from "@/render/browserImages";
import { CanvasDrawTarget, computeIntegerScale } from "@/render/draw";
import { ParticleEmitter } from "@/render/emitter";
import { Juice } from "@/render/juice";
import { startLoop } from "@/render/loop";
import { parseManifest, type Manifest } from "@/render/manifest";
import { SlotAudio } from "@/render/slot/audio";
import { SlotRenderer } from "@/render/slot/draw";
import { SLOT_LAYOUT, paylineY, reelX } from "@/render/slot/layout";
import { Lever } from "@/render/slot/lever";
import { ReelSet } from "@/render/slot/reels";
import { SlotVfx, TIER_PAYOFF } from "@/render/slot/vfx";
import { createWebAudioSink } from "@/render/slot/webAudio";
import { Timeline } from "@/render/timeline";
import { initialState, reduce, type FlowState, type Screen } from "./machine";
import { BootScreen } from "./screens/BootScreen";
import { TitleScreen } from "./screens/TitleScreen";
import { GameShell } from "./screens/GameShell";
import { UiKitProvider } from "@/ui/UiKit";
import { playTransition } from "@/ui/transitions";
import { pickPlayerDraw, type RunReel } from "./reelPick";
import styles from "./play.module.css";

interface PlanDecision {
  agentId: string;
  name: string;
  strategy: string;
  enter: boolean;
  stake: number;
  reason: string;
  source: "serv" | "heuristic";
  balanceWei: string;
}

interface PlanResponse {
  roundId: string;
  servCalls: number;
  costSummary: string;
  decisions: PlanDecision[];
  bots: number;
  entrants: number;
}

interface RunAgent {
  agentId: string;
  name: string;
  balanceBeforeWei: string;
  balanceAfterWei: string;
}

interface RunTransfer {
  kind: string;
  agentId: string;
  amountWei: string;
  txHash: string | null;
  link: string | null;
}

interface RunResponse {
  roundId: string;
  network: string;
  backend: string;
  winner: string;
  potWei: string;
  rakeWei: string;
  reconciled: boolean;
  transfers: RunTransfer[];
  agents: RunAgent[];
  reels: RunReel[];
  replay: { characters: never[]; log: never[]; placements: string[] };
}

interface Engine {
  store: AssetStore;
  manifest: Manifest;
  reels: ReelSet;
  lever: Lever;
  vfx: SlotVfx;
  audio: SlotAudio;
  slotRenderer: SlotRenderer;
  slotTarget: CanvasDrawTarget;
  arenaRenderer: ArenaRenderer;
  arenaTarget: CanvasDrawTarget;
  juice: Juice;
  timeline: Timeline | null;
  bulbsReversed: boolean;
  elapsedMs: number;
}

const SYMBOL_POOL = (manifest: Manifest): string[] => manifest.entries.map((e) => e.id);
const MAX_SCALE = 3;
/** Short unique token. Not a clock: this screen may not read time outside the loop. */
const token = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 10);


async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(typeof parsed?.error === "string" ? parsed.error : `HTTP ${response.status}`);
  return parsed as T;
}

export function PlayClient() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [leverNote, setLeverNote] = useState("");

  const slotCanvasRef = useRef<HTMLCanvasElement>(null);
  const arenaCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  // The loop reads the current screen without being restarted on every
  // change, so the ref is synced in an effect rather than during render.
  const stateRef = useRef<FlowState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  /** Provisional reel targets, replaced by the real draw when the round lands. */
  const pendingDrawRef = useRef<[string, string, string] | null>(null);

  // The manifest first and on its own, because the boot screen draws itself
  // from the ui kit it describes and reports progress against its contents.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/assets/manifest.json");
        if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
        const parsed = parseManifest(await response.json());
        if (!cancelled) setManifest(parsed);
      } catch (e) {
        if (!cancelled) setAssetError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Engine and the single loop. Built once the manifest is in, torn down once.
  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    let stop: (() => void) | undefined;

    void (async () => {
      try {
        const store = await loadAssets(manifest, createBrowserImageLoader());
        const sink = await createWebAudioSink(manifest.audio);
        if (cancelled) return;

        const slotCanvas = slotCanvasRef.current;
        const arenaCanvas = arenaCanvasRef.current;
        if (!slotCanvas || !arenaCanvas) return;

        const slotRenderer = new SlotRenderer(store);
        const slotTarget = new CanvasDrawTarget(slotCanvas, slotRenderer.width, slotRenderer.height, (img) => store.whiteOf(img));
        const arenaRenderer = new ArenaRenderer(store, { arena: DEFAULT_ROUND.arena });
        const arenaTarget = new CanvasDrawTarget(arenaCanvas, arenaRenderer.width, arenaRenderer.height, (img) => store.whiteOf(img));
        const fxRng = createRng("slot-vfx");
        const emitter = new ParticleEmitter(() => fxRng.nextU32() / 0x1_0000_0000);
        const audio = new SlotAudio(manifest.audio, sink, { storage: window.localStorage });

        const engine: Engine = {
          store,
          manifest,
          reels: new ReelSet(DEFAULT_SLOT, SYMBOL_POOL(manifest)),
          lever: new Lever(DEFAULT_SLOT),
          vfx: new SlotVfx(emitter),
          audio,
          slotRenderer,
          slotTarget,
          arenaRenderer,
          arenaTarget,
          juice: new Juice(store, emitter, (x, y) => arenaRenderer.tileToPixel(x, y)),
          timeline: null,
          bulbsReversed: false,
          elapsedMs: 0,
        };
        engineRef.current = engine;
        setMuted(audio.muted);

        // Reel stops: click, ring, and a tiered burst on the last one.
        engine.reels.onStop((index) => {
          engine.audio.reelStop(index);
          const x = reelX(SLOT_LAYOUT, index) + SLOT_LAYOUT.reel.width / 2;
          const y = paylineY(SLOT_LAYOUT);
          engine.vfx.flashRing(x, y, index === 2 ? 1.6 : 1);
          if (index === 1 && engine.reels.nearMiss) engine.audio.nearMiss();
          if (index === 2) {
            engine.audio.stopSpin();
            dispatch({ type: "reelsSettled" });
          }
        });

        engine.lever.onCommit(() => {
          engine.audio.leverPull();
          setLeverNote("Committed. The pull is locked.");
        });
        engine.lever.onRelease(() => {
          // Spin immediately on a provisional landing. The real draw arrives
          // from the server a beat later and retargets the reels mid spin, so
          // the player never waits on the network to see motion.
          engine.audio.startSpin();
          const pool = SYMBOL_POOL(manifest);
          const provisional = pendingDrawRef.current ?? ([pool[0], pool[1], pool[2]] as [string, string, string]);
          engine.reels.start(provisional, 1);
          setLeverNote("");
        });

        const fit = (): void => {
          const slotScale = computeIntegerScale(Math.min(window.innerWidth - 48, 640), 520, slotRenderer.width, slotRenderer.height);
          slotTarget.setScale(Math.min(MAX_SCALE, slotScale));
          const arenaScale = computeIntegerScale(Math.min(window.innerWidth - 48, 900), window.innerHeight - 260, arenaRenderer.width, arenaRenderer.height);
          arenaTarget.setScale(Math.min(2, arenaScale));
        };
        fit();
        window.addEventListener("resize", fit);

        const loop = startLoop((deltaMs) => {
          engine.elapsedMs += deltaMs;
          engine.lever.advance(deltaMs);
          engine.reels.advance(deltaMs);
          engine.vfx.advance(deltaMs);

          const screen = stateRef.current.screen;
          if (screen === "arena" && engine.timeline) {
            if (!engine.juice.frozen) engine.timeline.advance(deltaMs);
            engine.juice.update(deltaMs);
            engine.juice.frame();
            const actors = engine.timeline.actors();
            arenaTarget.beginFrame();
            arenaRenderer.draw(arenaTarget, { actors, timeMs: engine.timeline.timeMs, fx: engine.juice.actorFx(actors), drawEffects: (t) => engine.juice.drawEffects(t) });
            if (engine.timeline.finished) dispatch({ type: "playbackFinished" });
          } else {
            slotTarget.beginFrame();
            slotRenderer.draw(slotTarget, {
              reels: engine.reels.reelStates(),
              timeMs: engine.elapsedMs,
              leverProgress: engine.lever.progress,
              bulbsReversed: engine.bulbsReversed,
              drawEffects: (t) => engine.vfx.draw(t),
            });
          }
        });

        stop = () => {
          loop.stop();
          window.removeEventListener("resize", fit);
          sink.close();
        };
      } catch (e) {
        if (!cancelled) setAssetError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
      engineRef.current = null;
    };
  }, [manifest]);

  const unlockAudio = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.audio.unlock();
    setMuted(engine.audio.muted);
  }, []);

  const startSession = (): void => {
    unlockAudio();
    dispatch({ type: "connected", player: { id: `player-${token()}`, label: "Guest session" } });
  };

  const chooseMode = async (modeId: string, stake: StakeTierId): Promise<void> => {
    unlockAudio();
    engineRef.current?.audio.select();
    dispatch({ type: "modeChosen", modeId, stake });
    const mode = GAME_MODES.find((m) => m.id === modeId);
    if (!mode || mode.locked) {
      engineRef.current?.audio.locked();
      return;
    }
    try {
      const plan = await postJson<PlanResponse>("/api/round/plan", { seed: `slot-${token()}`, entrants: mode.entrants ?? 24 });
      dispatch({ type: "planLoaded", plan });
    } catch (e) {
      dispatch({ type: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const plan = state.plan as PlanResponse | null;
  const run = state.run as RunResponse | null;

  const pullLever = async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine || !state.leverLive || !plan) return;
    unlockAudio();
    if (!engine.lever.pull()) return;
    dispatch({ type: "leverPulled" });
    setLeverNote("");

    try {
      const mode = state.mode;
      const settled = await postJson<RunResponse>("/api/round/run", { seed: plan.roundId.replace(/^r-/, "s"), entrants: mode?.entrants ?? 24 });
      const draw = pickPlayerDraw(settled.reels);
      if (draw) {
        const symbols = draw.symbols as [string, string, string];
        // Always record the draw first. If the reels have not started yet the
        // lever's own release will pick it up, which matters because a fast
        // answer must never cut the dead air short: starting the reels here
        // would skip the pause the pull is built around.
        pendingDrawRef.current = symbols;
        if (engine.reels.state === "spinning") {
          // Already turning, so retarget rather than restart and nothing jumps.
          engine.reels.retarget(symbols);
        }
        engine.bulbsReversed = TIER_PAYOFF({ tier: draw.tier, combo: draw.combo }).reverseBulbs;
      }
      engine.timeline = new Timeline(settled.replay as never);
      engine.timeline.onBatch((batch, silent) => engine.juice.onBatch(batch, silent, (id) => engine.timeline!.actor(id)));
      engine.timeline.play();
      dispatch({ type: "roundReady", run: settled });
    } catch (e) {
      engine.audio.stopSpin();
      engine.lever.releaseToIdle();
      dispatch({ type: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  // Payoff once the reels have landed and the draw is known.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || state.screen !== "arena" || !run) return;
    const draw = pickPlayerDraw(run.reels);
    if (!draw) return;
    const payoff = TIER_PAYOFF({ tier: draw.tier, combo: draw.combo });
    const x = SLOT_LAYOUT.window.x + SLOT_LAYOUT.window.width / 2;
    const y = paylineY(SLOT_LAYOUT);
    for (let i = 0; i < payoff.rings; i++) engine.vfx.flashRing(x, y, 1 + i * 0.5);
    engine.vfx.coinBurst(x, y, payoff.coinIntensity);
    if (payoff.shine) engine.vfx.shineSweep(SLOT_LAYOUT.window);
    engine.audio.win(draw.combo === "threeOfAKind");
    engine.lever.releaseToIdle();
  }, [state.screen, run]);

  // Payout sound on the result screen.
  useEffect(() => {
    if (state.screen !== "result") return;
    engineRef.current?.audio.payout();
  }, [state.screen]);

  const playAgain = (): void => {
    const engine = engineRef.current;
    if (engine) {
      engine.reels.reset();
      engine.vfx.clear();
      engine.juice.reset();
      engine.timeline = null;
      engine.bulbsReversed = false;
    }
    dispatch({ type: "playAgain" });
  };

  const toggleMute = (): void => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.audio.toggleMuted();
    setMuted(engine.audio.muted);
  };


  // Screen transitions: one timeline per change, driven from the machine's
  // screen value. anime.js owns DOM chrome; the canvas Timeline owns the reels
  // and the arena, and they never target the same element.
  const screenRef = useRef<HTMLDivElement>(null);
  const previousScreen = useRef<Screen | null>(null);
  useEffect(() => {
    const node = screenRef.current;
    if (!node || previousScreen.current === state.screen) return;
    const from = previousScreen.current;
    previousScreen.current = state.screen;
    if (from === null) return;
    void playTransition(null, node, { grid: state.screen === "modeSelect" ? [3, 2] : undefined });
  }, [state.screen]);

  if (assetError) {
    return (
      <main className={styles.shell}>
        <p className={styles.error} role="alert">
          Assets failed to load. {assetError}
        </p>
      </main>
    );
  }

  if (!manifest) {
    return (
      <main className={styles.shell}>
        <p className={styles.dim}>Reading the manifest</p>
      </main>
    );
  }

  return (
    <UiKitProvider manifest={manifest}>
      <div onPointerDown={unlockAudio}>
        {state.screen === "boot" && <BootScreen manifest={manifest} onReady={() => dispatch({ type: "assetsReady" })} />}
        {state.screen === "title" && <TitleScreen onStart={startSession} />}

        <div ref={screenRef} className={state.screen === "boot" || state.screen === "title" ? styles.hidden : undefined}>
          <GameShell
            state={state}
            plan={plan}
            run={run}
            muted={muted}
            leverNote={leverNote}
            slotCanvasRef={slotCanvasRef}
            arenaCanvasRef={arenaCanvasRef}
            onChooseMode={(modeId, stake) => void chooseMode(modeId, stake)}
            onPull={() => void pullLever()}
            onPlayAgain={playAgain}
            onToggleMute={toggleMute}
          />
        </div>
      </div>
    </UiKitProvider>
  );
}
