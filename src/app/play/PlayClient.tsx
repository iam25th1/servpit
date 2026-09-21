"use client";

// The player flow. One machine decides the screen, one loop drives every
// animation on the page, and the loop is started once and never restarted, so
// moving from the slot to the arena does not reset the clock or reload
// anything. Both canvases stay mounted; only their visibility changes.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { GAME_MODES } from "@/config/modes";
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
import type { EntryShape } from "./screens/GameShell";
import type { DecidedShape } from "./screens/lineupRows";
import { UiKitProvider } from "@/ui/UiKit";
import { createResponsiveScope, playTransition } from "@/ui/transitions";
import { Stage } from "@/ui/Stage";
import { readNdjson } from "./ndjson";
import { getWithTimeout, requestWithTimeout, RequestTimeoutError } from "./request";
import { pickPlayerDraw, type RunReel } from "./reelPick";
import { runRequestFor } from "./roundRequest";
import { arenaStanding, type ArenaStanding } from "./screens/arenaHud";
import type { GraveShape } from "./screens/graveyardRows";
import type { ReplacementShape, WreckShape } from "./screens/wreckMoment";
import type { BankShape, LoanShape, RefusalShape } from "./screens/BankPanel";
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
  /** The seed the plan was built from, which the run must be settled with. */
  seed: string;
  servCalls: number;
  costSummary: string;
  decisions: PlanDecision[];
  bots: number;
  entrants: number;
  /** The lender's state, or null when the bank is off. Shapes live in BankPanel. */
  bank?: BankShape | null;
  loans?: LoanShape[];
  refusals?: RefusalShape[];
  tappedOut?: string[];
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
  /** True when the chain settles for real, so a hash is worth linking. */
  settles: boolean;
  winner: string;
  potWei: string;
  rakeWei: string;
  reconciled: boolean;
  transfers: RunTransfer[];
  agents: RunAgent[];
  repayment?: { agentId: string; name: string; interestWei: string; principalWei: string; paidWei: string; link: string | null } | null;
  /** Seats emptied this round, and who took them. Empty with the bank off. */
  wrecks?: WreckShape[];
  replacements?: ReplacementShape[];
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


/** Shown when nothing more specific is known. Never a library's words. */
const GENERIC_FAILURE = "Something went wrong. Try again in a moment.";

/**
 * A message the server already wrote for the player, carried through the
 * catch that turns a failed step into the error state.
 */
class ShownFailure extends Error {}

/**
 * What the player is shown for a failure.
 *
 * Only a message this application wrote gets through. Anything else, a fetch
 * rejection or a library error, becomes the generic sentence: viem quotes the
 * full endpoint url in its transport errors, and a keyed endpoint carries its
 * credential in that url, so the browser is the last place that text belongs.
 */
function playerMessage(e: unknown): string {
  if (e instanceof ShownFailure) return e.message;
  if (e instanceof RequestTimeoutError) return "That took too long. Try again in a moment.";
  return GENERIC_FAILURE;
}

export function PlayClient({ bankEnabled = false }: { bankEnabled?: boolean } = {}) {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [leverNote, setLeverNote] = useState("");
  // What the arena HUD shows while the replay runs. It is read from the
  // timeline's own actor state on each batch, so the count and the feed are
  // driven by the same clock the canvas draws from rather than a second one.
  const [arena, setArena] = useState<ArenaStanding>({ standing: 0, downed: [] });
  /** The wall, once it has been read. Null while the request is in flight. */
  const [graves, setGraves] = useState<GraveShape[] | null>(null);

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
            engine.juice.advance(deltaMs);
            const actors = engine.timeline.actors();
            arenaTarget.beginFrame();
            arenaRenderer.draw(arenaTarget, { actors, timeMs: engine.timeline.timeMs, fx: engine.juice.actorFx(actors), drawEffects: (t) => engine.juice.drawEffects(t) });
            if (engine.timeline.finished) {
              // The machine never reads the run payload, so what it is told
              // is whether anybody was finished, not who.
              const finished = (stateRef.current.run as RunResponse | null)?.wrecks ?? [];
              dispatch({ type: "playbackFinished", wrecked: finished.length > 0 });
            }
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

  const chooseMode = async (modeId: string): Promise<void> => {
    unlockAudio();
    engineRef.current?.audio.select();
    dispatch({ type: "modeChosen", modeId });
    const mode = GAME_MODES.find((m) => m.id === modeId);
    if (!mode || mode.locked) {
      engineRef.current?.audio.locked();
      return;
    }
    try {
      // Streamed, so each agent appears the moment it reports rather than
      // all six appearing together after the slowest one lands.
      const { response, done } = await requestWithTimeout("/api/round/plan", { seed: `slot-${token()}`, entrants: mode.entrants ?? 24 });
      if (!response.ok) {
        done();
        throw new Error(`HTTP ${response.status}`);
      }
      let streamError: string | null = null;
      try {
        await readNdjson(response, (value) => {
          const line = value as { type?: string; decision?: unknown; plan?: unknown; message?: string; error?: string };
          if (line.type === "decision") dispatch({ type: "agentDecided", decision: line.decision });
          else if (line.type === "plan") dispatch({ type: "planLoaded", plan: line.plan });
          // The server sends a sentence written for the player. Anything else
          // on this line is not shown.
          else if (line.type === "error") streamError = line.message ?? line.error ?? GENERIC_FAILURE;
        });
      } finally {
        done();
      }
      if (streamError !== null) throw new ShownFailure(streamError);
    } catch (e) {
      dispatch({ type: "failed", message: playerMessage(e) });
    }
  };

  /**
   * Reads the wall, and shows it whatever comes back.
   *
   * Asked for each time it is opened rather than cached, because a round
   * settled since the last look is exactly what somebody opening it wants to
   * see. A failure lands in the flow's own error state, so the screen says
   * something rather than sitting on an empty wall.
   */
  const showGraveyard = async (): Promise<void> => {
    setGraves(null);
    dispatch({ type: "showGraveyard" });
    try {
      const body = await getWithTimeout<{ enabled: boolean; graves: GraveShape[] }>("/api/graveyard");
      setGraves(body.graves ?? []);
    } catch (e) {
      setGraves([]);
      dispatch({ type: "failed", message: playerMessage(e) });
    }
  };

  const retry = (): void => {
    if (!state.mode) return;
    void chooseMode(state.mode.id);
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
      // Streamed like the plan: each buy in appears as it confirms on chain,
      // then a final line with the settled round.
      const { response, done } = await requestWithTimeout("/api/round/run", runRequestFor(plan, mode?.entrants ?? 24));
      if (!response.ok) {
        done();
        throw new Error(`HTTP ${response.status}`);
      }
      let received: RunResponse | undefined;
      let runError: string | null = null;
      try {
        await readNdjson(response, (value) => {
          const line = value as { type?: string; entry?: unknown; result?: RunResponse; message?: string; error?: string };
          if (line.type === "entry") dispatch({ type: "entryConfirmed", entry: line.entry });
          else if (line.type === "result") received = line.result;
          else if (line.type === "error") runError = line.message ?? line.error ?? GENERIC_FAILURE;
        });
      } finally {
        done();
      }
      if (runError !== null) throw new ShownFailure(runError);
      if (!received) throw new Error("the round ended without a result");
      const settled: RunResponse = received;
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
      // One floor per round: the tile and scatter variation is seeded from
      // the round, so two rounds do not run on the same pit floor.
      engine.arenaRenderer.floorSeed = settled.roundId;
      engine.timeline = new Timeline(settled.replay as never);
      engine.timeline.onBatch((batch, silent) => engine.juice.onBatch(batch, silent, (id) => engine.timeline!.actor(id)));
      // The HUD reads the tick that has already been applied, so the standing
      // count falls as the pit empties instead of sitting at the entrant
      // count for the whole replay.
      setArena(arenaStanding(engine.timeline.actors()));
      engine.timeline.onBatch(() => setArena(arenaStanding(engine.timeline!.actors())));
      engine.timeline.play();
      dispatch({ type: "roundReady", run: settled });
    } catch (e) {
      engine.audio.stopSpin();
      engine.lever.releaseToIdle();
      dispatch({ type: "failed", message: playerMessage(e) });
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
    setArena({ standing: 0, downed: [] });
    dispatch({ type: "playAgain" });
  };

  const toggleMute = (): void => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.audio.toggleMuted();
    setMuted(engine.audio.muted);
  };


  // One responsive scope for the whole app: it registers the phone and
  // reduced motion queries once and reverts what it owns on teardown.
  const scopeRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scopeRootRef.current;
    if (!root) return;
    const scope = createResponsiveScope(root);
    return () => scope.revert();
  }, [manifest]);

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
      <Stage>
      <div ref={scopeRootRef} className={styles.root} onPointerDown={unlockAudio}>
        {state.screen === "boot" && <BootScreen manifest={manifest} onReady={() => dispatch({ type: "assetsReady" })} />}
        {state.screen === "title" && <TitleScreen onStart={startSession} />}

        <div ref={screenRef} className={state.screen === "boot" || state.screen === "title" ? styles.hidden : undefined}>
          <GameShell
            state={state}
            plan={plan}
            run={run}
            muted={muted}
            leverNote={leverNote}
            arena={arena}
            decided={state.decided as DecidedShape[]}
            entries={state.entries as EntryShape[]}
            slotCanvasRef={slotCanvasRef}
            arenaCanvasRef={arenaCanvasRef}
            bankEnabled={bankEnabled}
            graves={graves}
            onChooseMode={(modeId) => void chooseMode(modeId)}
            onShowGraveyard={() => void showGraveyard()}
            onCloseGraveyard={() => dispatch({ type: "closeGraveyard" })}
            onWreckSeen={() => dispatch({ type: "wreckSeen" })}
            onRetry={retry}
            onPull={() => void pullLever()}
            onPlayAgain={playAgain}
            onToggleMute={toggleMute}
          />
        </div>
      </div>
      </Stage>
    </UiKitProvider>
  );
}
