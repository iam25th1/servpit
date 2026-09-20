"use client";

// Every screen after the title. All containers are nine patches from the pack,
// all controls are its button and tab sprites, and every list entrance is an
// anime.js stagger. The canvas Timeline still owns the reels and the arena;
// nothing here animates a canvas, and anime.js never targets one.

import { animate, stagger, utils } from "animejs";
import { createMotionPath } from "animejs/svg";
import { useEffect, useRef, useState, type RefObject } from "react";
import { GAME_MODES, type StakeTierId } from "@/config/modes";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Meter } from "@/ui/Meter";
import { NinePatch } from "@/ui/NinePatch";
import { useUiKit } from "@/ui/UiKit";
import { ninePatchStyle } from "@/ui/ninePatchGeometry";
import { uiScale } from "@/ui/tokens";
import { staggerIn } from "@/ui/transitions";
import type { FlowState } from "../machine";
import type { ArenaStanding } from "./arenaHud";
import { swingMeters } from "./bankrollMeter";
import { entrantLabel } from "./entrantLabel";
import { transferRows } from "./transferRows";
import styles from "./shell.module.css";

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

interface PlanShape {
  decisions: PlanDecision[];
  bots: number;
  entrants: number;
  costSummary: string;
  servCalls: number;
}

interface RunAgent {
  agentId: string;
  name: string;
  balanceBeforeWei: string;
  balanceAfterWei: string;
}

interface RunShape {
  winner: string;
  potWei: string;
  rakeWei: string;
  network: string;
  backend: string;
  /** True when the chain settles for real, so a hash is worth linking. */
  settles: boolean;
  reconciled: boolean;
  agents: RunAgent[];
  transfers: Array<{ kind: string; agentId: string; amountWei: string; txHash: string | null; link: string | null }>;
  replay: { placements: string[] };
}

export interface GameShellProps {
  state: FlowState;
  plan: PlanShape | null;
  run: RunShape | null;
  muted: boolean;
  leverNote: string;
  /** Live from the replay's timeline, not from the final placement list. */
  arena: ArenaStanding;
  slotCanvasRef: RefObject<HTMLCanvasElement | null>;
  arenaCanvasRef: RefObject<HTMLCanvasElement | null>;
  onChooseMode: (modeId: string, stake: StakeTierId) => void;
  onPull: () => void;
  onPlayAgain: () => void;
  onToggleMute: () => void;
}


export function GameShell(props: GameShellProps) {
  const { state, plan, run } = props;
  const { ui, modeIcon, facesetPath } = useUiKit();
  const showStage = state.screen === "lobby" || state.screen === "slot" || state.screen === "spinning" || state.screen === "arena";

  return (
    <main className={styles.shell}>
      <header className={styles.topbar} data-anim="topbar">
        <h1 className={styles.wordmark}>SERVPIT</h1>
        <div className={styles.topmeta}>
          {state.player && <span>{state.player.label}</span>}
          <Button onClick={props.onToggleMute} scale={2} aria-pressed={!props.muted}>
            {props.muted ? "Sound off" : "Sound on"}
          </Button>
        </div>
      </header>

      <div className={styles.body}>
      {state.screen === "modeSelect" && <ModeSelect onChoose={props.onChooseMode} error={state.error} />}

      {/* The stage is always mounted so the canvases exist before the player
          reaches them; the engine builds against them during boot. Only its
          visibility changes. */}
      <div className={showStage ? styles.playfield : styles.offstage} aria-hidden={!showStage}>
          <div className={styles.cabinet}>
            <NinePatch sprite="panelAlt" data-anim="cabinet" style={{ padding: "var(--space-base)" }}>
              <canvas ref={props.slotCanvasRef} className={`${styles.canvas} ${state.screen === "arena" ? styles.hidden : ""}`} role="img" aria-label="Slot machine" />
              <canvas ref={props.arenaCanvasRef} className={`${styles.canvas} ${state.screen === "arena" ? "" : styles.hidden}`} role="img" aria-label="Arena replay" />
            </NinePatch>
            {state.screen !== "arena" && (
              <>
                <Button onClick={props.onPull} disabled={!state.leverLive}>
                  {state.screen === "lobby" ? "Agents deciding" : state.leverLive ? "Pull the lever" : "Locked in"}
                </Button>
                <p className={styles.leverNote}>{props.leverNote}</p>
              </>
            )}
          </div>

          {state.screen === "arena" ? <ArenaHud run={run} arena={props.arena} /> : <Lineup plan={plan} error={state.error} />}
      </div>

      {state.screen === "result" && run && <ResultScreen run={run} onPlayAgain={props.onPlayAgain} />}
      </div>
    </main>
  );

  function ModeSelect({ onChoose, error }: { onChoose: (modeId: string, stake: StakeTierId) => void; error: string | null }) {
    const gridRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const cards = gridRef.current ? [...gridRef.current.querySelectorAll<HTMLElement>("[data-card]")] : [];
      void staggerIn(cards, { grid: [3, 2] });
    }, []);

    return (
      <>
        <div ref={gridRef} className={`${styles.modes} ${styles.fill}`}>
          {GAME_MODES.map((mode) => {
            const icon = modeIcon(mode.id);
            const lockIcon = modeIcon("locked");
            return (
              <NinePatch
                key={mode.id}
                sprite={mode.locked ? "panelDisabled" : "panel"}
                className={styles.modeCard}
                data-card=""
                aria-disabled={mode.locked}
              >
                {/* Slats first, so everything after them sits on top and the
                    mode name stays readable while the body is shuttered. */}
                {mode.locked && (
                  <div className={styles.shutter} aria-hidden="true">
                    {Array.from({ length: 14 }, (_, i) => (
                      <span key={i} className={styles.slat} />
                    ))}
                  </div>
                )}

                <div className={`${styles.modeHead} ${mode.locked ? styles.aboveShutter : ""}`}>
                  <img className={styles.modeIcon} src={icon.path} alt="" width={icon.width * 2} height={icon.height * 2} />
                  <h2 className={styles.modeName}>{mode.name}</h2>
                </div>
                {/* A shuttered card does not show its body. The slats drew
                    straight through the blurb, which read as broken text
                    rather than as a closed card, and no colour clears the
                    threshold against alternating slat and panel. */}
                {mode.locked ? <div className={styles.shutterFill} /> : <p className={styles.modeBlurb}>{mode.blurb}</p>}

                {mode.locked ? (
                  <div className={styles.lockBadge}>
                    <img src={lockIcon.path} alt="" width={16} height={16} style={{ imageRendering: "pixelated" }} />
                    <span className={styles.roadmap}>{mode.roadmap}</span>
                  </div>
                ) : (
                  <div className={styles.stakes}>
                    {mode.stakes?.map((stake) => (
                      <StakeTab key={stake.id} label={`${stake.label} ${stake.minorUnits}`} onSelect={() => onChoose(mode.id, stake.id)} />
                    ))}
                  </div>
                )}
              </NinePatch>
            );
          })}
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </>
    );
  }

  function StakeTab({ label, onSelect }: { label: string; onSelect: () => void }) {
    const [sprite, setSprite] = useState<"tab" | "tabHover" | "tabSelected">("tab");
    return (
      <button
        type="button"
        className={styles.stakeTab}
        style={ninePatchStyle(ui(sprite), 2)}
        onPointerEnter={() => setSprite("tabHover")}
        onPointerLeave={() => setSprite("tab")}
        onPointerDown={() => setSprite("tabSelected")}
        onClick={onSelect}
      >
        {label}
      </button>
    );
  }

  function Lineup({ plan, error }: { plan: PlanShape | null; error: string | null }) {
    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
      if (!plan) return;
      const rows = listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>("li")] : [];
      // Decisions arrive one after another, not all at once.
      void staggerIn(rows);
    }, [plan]);


    return (
      <NinePatch sprite="bg" data-anim="lineup">
        <h2 className={styles.sideHead}>Who is in</h2>
        <p className={styles.sideNote}>
          {plan
            ? `${plan.decisions.filter((d) => d.enter).length} of ${plan.decisions.length} committed, ${plan.bots} house bots fill the rest. ${plan.servCalls} SERV calls.`
            : "Asking each agent about its own balance."}
        </p>
        <ul ref={listRef} className={styles.lineup}>
          {plan?.decisions.map((d) => {
            return (
              <li key={d.agentId} className={styles.agentRow}>
                <div className={styles.agentPortrait}>
                  <img className={styles.faceset} src={facesetPath(characterFor(d.agentId))} alt="" width={38} height={38} />
                </div>
                <div className={styles.agentBody}>
                  <span className={styles.agentLine}>
                    <span className={styles.agentName}>
                      {d.name} <span className={d.enter ? styles.in : styles.agentVerdict}>{d.enter ? `in for ${d.stake}` : "holding"}</span>
                    </span>
                  </span>
                  <Dialog scale={2}>{d.reason}</Dialog>
                </div>
              </li>
            );
          })}
        </ul>
        {error && <p className={styles.error}>{error}</p>}
      </NinePatch>
    );
  }

  function ArenaHud({ run, arena }: { run: RunShape | null; arena: ArenaStanding }) {
    const feedRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
      // Only the line that just arrived. Staggering the whole list on every
      // death set every item back to zero opacity and restarted the run, so
      // with ten entrants out the feed showed three: the rest were mid fade
      // when the next death restarted them.
      const first = feedRef.current?.querySelector<HTMLElement>("li");
      if (first) void staggerIn([first]);
    }, [arena.downed.length]);

    const entrants = run?.replay.placements.length ?? 0;
    return (
      <NinePatch sprite="bg" data-anim="hud" className={styles.hud}>
        <h2 className={styles.sideHead}>The pit</h2>
        <div className={styles.hudRow}>
          <span>Standing</span>
          <span className={styles.hudValue}>
            {arena.standing}
            {entrants > 0 ? <span className={styles.hudOf}> of {entrants}</span> : null}
          </span>
        </div>
        <div className={styles.hudRow}>
          <span>Pot</span>
          <span className={styles.hudValue}>{run ? run.potWei : "-"}</span>
        </div>
        {/* The feed grows as the pit empties. It used to render the final
            placement list in full the moment the replay started, which is
            how the count beside it came to disagree with it. */}
        <ul ref={feedRef} className={styles.feed}>
          {arena.downed.slice(0, 12).map((id, i) => (
            <li key={id} className={styles.feedItem}>
              {arena.standing + i + 1}. {entrantLabel(id, run?.agents ?? [])} is out
            </li>
          ))}
        </ul>
      </NinePatch>
    );
  }

  function ResultScreen({ run, onPlayAgain }: { run: RunShape; onPlayAgain: () => void }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const coinPathRef = useRef<SVGPathElement>(null);
    const prize = BigInt(run.potWei) - BigInt(run.rakeWei);
    const meters = swingMeters(run.agents.map((a) => ({ agentId: a.agentId, changeWei: BigInt(a.balanceAfterWei) - BigInt(a.balanceBeforeWei) })));
    const winnerName = entrantLabel(run.winner, run.agents);

    useEffect(() => {
      const root = rootRef.current;
      const path = coinPathRef.current;
      if (!root) return;
      void staggerIn([...root.querySelectorAll<HTMLElement>("[data-ledger-row]")], { delay: 200 });

      if (!path || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const coins = [...root.querySelectorAll<HTMLElement>("[data-coin]")];
      if (coins.length === 0) return;
      // Coins travel the pot to winner arc. Each coin is its own element and
      // the page never moves.
      const motion = createMotionPath(path);
      utils.set(coins, { opacity: 1 });
      animate(coins, {
        x: motion.translateX,
        y: motion.translateY,
        duration: 900,
        ease: "inOutQuad",
        delay: stagger(70),
        onComplete: () => utils.set(coins, { opacity: 0 }),
      });
    }, [run]);

    const coinSprite = ui("meterFill");

    return (
      <div ref={rootRef} className={styles.result} data-anim="result">
        <svg className={styles.coinLayer} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path ref={coinPathRef} d="M 78 62 Q 50 6 20 30" fill="none" stroke="none" />
        </svg>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <img
            key={i}
            data-coin=""
            src={coinSprite.path}
            alt=""
            width={10}
            height={10}
            style={{ position: "absolute", left: 0, top: 0, opacity: 0, imageRendering: "pixelated", zIndex: 4 }}
          />
        ))}

        <NinePatch sprite="panelAlt" scale={uiScale} className={styles.winner} data-anim="winner-panel">
          <img className={styles.winnerFace} src={facesetPath(winnerCharacter(run))} alt="" width={38 * 2} height={38 * 2} />
          <h2 className={`${styles.winnerName} ${styles.nameplate}`}>{winnerName}</h2>
          <p className={styles.winnerPot}>{prize.toString()} taken</p>
          <p className={styles.sideNote}>Reconciliation {run.reconciled ? "held against chain balances" : "FAILED"}</p>
        </NinePatch>

        <NinePatch sprite="bg" className={styles.ledger} data-anim="ledger">
          <h2 className={styles.sideHead}>Bankrolls</h2>
          {run.agents.map((a) => {
            const change = BigInt(a.balanceAfterWei) - BigInt(a.balanceBeforeWei);
            return (
              <div key={a.agentId} className={styles.ledgerRow} data-ledger-row="">
                <span>{a.name}</span>
                <Meter value={meters.get(a.agentId) ?? 0} variant="mini" scale={5} label={`${a.name} swing this round`} />
                <span className={`${styles.delta} ${change > 0n ? styles.up : styles.down}`}>
                  {change >= 0n ? "+" : ""}
                  {change.toString()}
                </span>
              </div>
            );
          })}
        </NinePatch>

        <NinePatch sprite="bg" className={styles.transfers} data-anim="transfers">
          <h2 className={styles.sideHead}>Transfers</h2>
          <ul className={styles.transferList}>
            {transferRows(run.transfers).map((row) => (
              <li key={`${row.kind}-${row.label}`} className={styles.transferRow} data-transfer-row="">
                <span className={styles.transferLabel}>{row.label}</span>
                <span className={styles.transferAmount}>{row.amountWei}</span>
                {row.explorable ? (
                  <a className={styles.transferHash} href={row.link ?? undefined} target="_blank" rel="noreferrer">
                    {row.hashShort}
                  </a>
                ) : (
                  <span className={`${styles.transferHash} ${styles.dim}`}>{row.hashShort}</span>
                )}
              </li>
            ))}
          </ul>
        </NinePatch>

        {/* The notice and the action share a row. Stacked they cost the
            composition 74 px it does not have, and the result screen ran off
            the bottom of the stage and over the top bar. */}
        <div className={styles.footer}>
          <p className={styles.notice}>
            {run.settles
              ? `Settled on ${run.network}. Every hash above links to the block explorer.`
              : "This round ran off chain against the local test chain. The hashes above are local, so there is nothing to look up on a block explorer. Set the wallet keys to settle on Base Sepolia."}
          </p>
          <Button onClick={onPlayAgain}>Another round</Button>
        </div>
      </div>
    );
  }
}

/** Placeholder mapping until agents carry a character; keeps facesets real. */
function characterFor(agentId: string): string {
  const roster = ["NinjaRed", "NinjaBlue", "Knight", "Monk", "Hunter", "Boy"];
  let hash = 0;
  for (const ch of agentId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return roster[hash % roster.length];
}

function winnerCharacter(run: RunShape): string {
  return characterFor(run.winner);
}
