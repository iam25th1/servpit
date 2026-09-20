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
import { initialState, reduce, type FlowState } from "./machine";
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

const short = (s: string): string => `${s.slice(0, 6)}...${s.slice(-4)}`;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(typeof parsed?.error === "string" ? parsed.error : `HTTP ${response.status}`);
  return parsed as T;
}

export function PlayClient() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [assetsReady, setAssetsReady] = useState(false);
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

  // Assets, engine and the single loop. Built once, torn down once.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    void (async () => {
      try {
        const response = await fetch("/assets/manifest.json");
        if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
        const manifest = parseManifest(await response.json());
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
        setAssetsReady(true);
      } catch (e) {
        if (!cancelled) setAssetError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
      engineRef.current = null;
    };
  }, []);

  const unlockAudio = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.audio.unlock();
    setMuted(engine.audio.muted);
  }, []);

  const connect = (): void => {
    unlockAudio();
    const id = `player-${token()}`;
    dispatch({ type: "connected", player: { id, label: "Guest session" } });
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
        pendingDrawRef.current = symbols;
        // Already spinning: retarget rather than restart, so nothing jumps.
        if (!engine.reels.retarget(symbols)) {
          engine.reels.reset();
          engine.reels.start(symbols, 2);
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

  const winnerAgent = run?.agents.find((a) => `agent-${a.agentId}` === run.winner);
  const prize = run ? BigInt(run.potWei) - BigInt(run.rakeWei) : 0n;

  return (
    <main className={styles.shell} onPointerDown={unlockAudio}>
      <header className={styles.topbar}>
        <h1 className={styles.wordmark}>servpit</h1>
        <div className={styles.topmeta}>
          {state.player && <span>{state.player.label}</span>}
          <button type="button" className={styles.ghost} onClick={toggleMute} aria-pressed={!muted}>
            {muted ? "Sound off" : "Sound on"}
          </button>
        </div>
      </header>

      {assetError && (
        <p className={styles.error} role="alert">
          Assets failed to load. {assetError}
        </p>
      )}

      {state.screen === "connect" && (
        <section>
          <p className={styles.lede}>Six agents hold their own wallets and decide for themselves whether to enter.</p>
          <p className={styles.sub}>
            You pull the lever. They reason about their own balance first, and you see who is in and why before you commit. Rounds resolve on a seeded engine and
            settle through smart wallets.
          </p>
          <button type="button" className={styles.primary} onClick={connect} disabled={!assetsReady}>
            {assetsReady ? "Start a session" : "Loading the cabinet"}
          </button>
        </section>
      )}

      {state.screen === "modeSelect" && (
        <section>
          <p className={styles.lede}>Pick a pit.</p>
          <p className={styles.sub}>One mode is open. The rest are on the roadmap and are not playable yet.</p>
          <div className={styles.modes}>
            {GAME_MODES.map((mode) => (
              <div key={mode.id} className={`${styles.card} ${mode.locked ? styles.cardLocked : styles.cardOpen}`} aria-disabled={mode.locked}>
                <h2 className={styles.cardName}>{mode.name}</h2>
                <p className={styles.cardBlurb}>{mode.blurb}</p>
                {mode.locked ? (
                  <span className={styles.roadmap}>{mode.roadmap}</span>
                ) : (
                  <div className={styles.stakes}>
                    {mode.stakes?.map((stake) => (
                      <button key={stake.id} type="button" onClick={() => void chooseMode(mode.id, stake.id)}>
                        {stake.label} · {stake.minorUnits}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {state.error && <p className={styles.error}>{state.error}</p>}
        </section>
      )}

      <div className={state.screen === "lobby" || state.screen === "slot" || state.screen === "spinning" || state.screen === "arena" ? undefined : styles.hidden}>
        <div className={styles.stage}>
          <div className={styles.cabinet}>
            <canvas ref={slotCanvasRef} className={`${styles.canvas} ${state.screen === "arena" ? styles.hidden : ""}`} role="img" aria-label="Slot machine" />
            <canvas ref={arenaCanvasRef} className={`${styles.canvas} ${state.screen === "arena" ? "" : styles.hidden}`} role="img" aria-label="Arena replay" />
            {state.screen !== "arena" && (
              <>
                <button type="button" className={styles.lever} onClick={() => void pullLever()} disabled={!state.leverLive}>
                  {state.screen === "lobby" ? "Agents deciding" : state.leverLive ? "Pull the lever" : "Locked in"}
                </button>
                <p className={styles.leverNote}>{leverNote}</p>
              </>
            )}
          </div>

          {state.screen !== "arena" && (
            <div className={styles.side}>
              <h2 className={styles.sideHead}>Who is in</h2>
              <p className={styles.sideNote}>
                {plan
                  ? `${plan.decisions.filter((d) => d.enter).length} of ${plan.decisions.length} agents committed, ${plan.bots} house bots fill the rest. ${plan.costSummary}.`
                  : "Asking each agent about its own balance."}
              </p>
              <ul className={styles.agents}>
                {plan?.decisions.map((d) => (
                  <li key={d.agentId} className={styles.agent}>
                    <div className={styles.agentTop}>
                      <span className={styles.agentName}>{d.name}</span>
                      <span className={d.enter ? styles.in : styles.out}>{d.enter ? `In for ${d.stake}` : "Holding"}</span>
                    </div>
                    <p className={styles.reason}>{d.reason}</p>
                    <p className={styles.source}>{d.source === "serv" ? "reasoned" : "heuristic fallback"}</p>
                  </li>
                ))}
              </ul>
              {state.error && <p className={styles.error}>{state.error}</p>}
            </div>
          )}
        </div>
      </div>

      {state.screen === "result" && run && (
        <section>
          <p className={styles.lede}>{winnerAgent ? `${winnerAgent.name} took the pot.` : `${run.winner} took the pot.`}</p>
          <div className={styles.result}>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Winner</p>
              <p className={styles.statValue}>{run.winner}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Payout, minor units</p>
              <p className={styles.statValue}>{prize.toString()}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Reconciliation</p>
              <p className={styles.statValue}>{run.reconciled ? "Held" : "Failed"}</p>
            </div>
          </div>

          <table className={styles.ledger}>
            <caption className={styles.statLabel}>Agent bankrolls</caption>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {run.agents.map((a) => {
                const change = BigInt(a.balanceAfterWei) - BigInt(a.balanceBeforeWei);
                return (
                  <tr key={a.agentId}>
                    <td>{a.name}</td>
                    <td>{a.balanceBeforeWei}</td>
                    <td>{a.balanceAfterWei}</td>
                    <td>{change >= 0n ? `+${change}` : change.toString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {run.transfers.length > 0 && (
            <table className={styles.ledger}>
              <caption className={styles.statLabel}>Transfers</caption>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Amount, wei</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {run.transfers.map((t) => (
                  <tr key={`${t.kind}-${t.agentId}`}>
                    <td>{t.kind}</td>
                    <td>{t.agentId}</td>
                    <td>{t.amountWei}</td>
                    <td>
                      {t.link ? (
                        <a href={t.link} target="_blank" rel="noreferrer">
                          {t.txHash ? short(t.txHash) : "view"}
                        </a>
                      ) : (
                        <span>{t.txHash ? short(t.txHash) : "none"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className={styles.chain}>
            {run.backend === "cdp"
              ? `Settled on ${run.network}. The transaction links above are the record.`
              : "This round ran off chain against the local test chain, so the hashes above are local and there is nothing to look up on a block explorer. Set the CDP credentials to settle on Base Sepolia."}
          </p>

          <div className={styles.row}>
            <button type="button" className={styles.primary} onClick={playAgain}>
              Another round
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
