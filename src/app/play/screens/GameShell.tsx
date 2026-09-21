"use client";

// Every screen after the title. All containers are nine patches from the pack,
// all controls are its button and tab sprites, and every list entrance is an
// anime.js stagger. The canvas Timeline still owns the reels and the arena;
// nothing here animates a canvas, and anime.js never targets one.

import { animate, createTimeline, stagger, utils } from "animejs";
import { createMotionPath } from "animejs/svg";
import { useEffect, useRef, useState, type RefObject } from "react";
import { GAME_MODES } from "@/config/modes";
import { BankPanel, loanBeats, type BankShape, type LoanShape, type RefusalShape } from "./BankPanel";
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
import { decidedCount, lineupRows, type DecidedShape, type OccupantShape } from "./lineupRows";
import { GRAVES_PER_PAGE, graveyardPage, type GraveShape } from "./graveyardRows";
import { wreckMoments, type ReplacementShape, type WreckShape } from "./wreckMoment";

/** One buy in, as the settle stream reports it. */
export interface EntryShape {
  agentId: string;
  name: string;
  amountWei: string;
  txHash: string | null;
  link: string | null;
  applied: boolean;
}

/** Exchanges the buy in panel has room for, newest last. Four asks answered. */
const BUYIN_BEATS = 8;

/** The transfer kinds only a round with a lender in it produces. */
const BANK_KINDS = new Set(["loan", "repayment", "seizure", "refill"]);

/** A hash short enough for a narrow column, or a word when there is none. */
const shortHash = (hash: string | null): string => (hash ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : "confirmed");
import { reconciliationNote, type ReconcileCheck } from "./reconciliationNote";
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
  /** Null when the bank is off, which is what says there is no lender. */
  bank?: BankShape | null;
  loans?: LoanShape[];
  refusals?: RefusalShape[];
  /** Agents that could not cover a seat and had to ask. */
  tappedOut?: string[];
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
  /** Wei one chip is worth, so the screen never assumes a funding target. */
  weiPerChip?: string;
  /** Per check detail, so a failure can name what went wrong. */
  checks?: ReconcileCheck[];
  agents: RunAgent[];
  /** What a winner handed the lender before it kept anything. Null when none. */
  repayment?: { agentId: string; name: string; interestWei: string; principalWei: string; paidWei: string; link: string | null } | null;
  transfers: Array<{ kind: string; agentId: string; amountWei: string; txHash: string | null; link: string | null }>;
  /** Seats emptied this round, and who took them. Empty with the bank off. */
  wrecks?: WreckShape[];
  replacements?: ReplacementShape[];
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
  /** Buy ins confirmed on chain so far, streamed while the round settles. */
  entries: EntryShape[];
  /** Decisions streamed so far, before the whole plan has landed. */
  decided: DecidedShape[];
  /** Who is in each seat, which the stream reports before anybody decides. */
  occupants: OccupantShape[];
  /** True only with the bank on, which is the only thing that makes a grave. */
  bankEnabled: boolean;
  /** The wall, once it has been read. Null while the request is in flight. */
  graves: GraveShape[] | null;
  slotCanvasRef: RefObject<HTMLCanvasElement | null>;
  arenaCanvasRef: RefObject<HTMLCanvasElement | null>;
  onChooseMode: (modeId: string) => void;
  /** Runs the failed step again. Shown next to any error the player can act on. */
  onRetry: () => void;
  onPull: () => void;
  onShowGraveyard: () => void;
  onCloseGraveyard: () => void;
  /** The player is done looking at whoever died. */
  onWreckSeen: () => void;
  onPlayAgain: () => void;
  onToggleMute: () => void;
}


export function GameShell(props: GameShellProps) {
  const { state, plan, run, decided, entries, occupants } = props;
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
      {state.screen === "graveyard" && <Graveyard graves={props.graves} error={state.error} onClose={props.onCloseGraveyard} />}

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
                  {state.screen === "lobby" ? "Agents deciding" : state.leverLive ? "Pull the lever" : "Agents buying in"}
                </Button>
                <p className={styles.leverNote}>{props.leverNote}</p>
                {/* Marrow sits under the cabinet, in the space the lever does
                    not use, rather than stacked above the lineup where it
                    would push the sixth agent off a stage that cannot grow.
                    With the bank off the plan carries no lender and nothing
                    renders here at all. */}
                {plan?.bank && <BankPanel bank={plan.bank} loans={plan.loans ?? []} refusals={plan.refusals ?? []} />}
              </>
            )}
          </div>

          {state.screen === "arena" ? (
            <ArenaHud run={run} arena={props.arena} />
          ) : state.screen === "spinning" ? (
            <BuyIns plan={plan} entries={entries} error={state.error} onRetry={props.onRetry} />
          ) : (
            <Lineup plan={plan} decided={decided} occupants={occupants} error={state.error} onRetry={props.onRetry} />
          )}
      </div>

      {state.screen === "wreck" && run && <WreckScreen run={run} onContinue={props.onWreckSeen} />}
      {state.screen === "result" && run && <ResultScreen run={run} onPlayAgain={props.onPlayAgain} />}
      </div>
    </main>
  );

  function ModeSelect({ onChoose, error }: { onChoose: (modeId: string) => void; error: string | null }) {
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
                  <div className={styles.enter}>
                    {/* A different word from the title screen's button, so the
                        two are not the same label doing two different jobs. */}
                    <EnterTab label="Take a seat" onSelect={() => onChoose(mode.id)} />
                  </div>
                )}
              </NinePatch>
            );
          })}
        </div>
        {error && <p className={styles.error}>{error}</p>}
        {/* The way into the graveyard, and the only one. It is a bank screen,
            so with the bank off there is no door and the menu is the menu it
            has always been. */}
        {props.bankEnabled && (
          <div className={styles.menuFooter} data-anim="menu-footer">
            <Button onClick={props.onShowGraveyard} scale={2}>
              The graveyard
            </Button>
            <p className={styles.menuFooterNote}>Everyone who has been carried out.</p>
          </div>
        )}
      </>
    );
  }

  function EnterTab({ label, onSelect }: { label: string; onSelect: () => void }) {
    const [sprite, setSprite] = useState<"tab" | "tabHover" | "tabSelected">("tab");
    return (
      <button
        type="button"
        className={styles.enterTab}
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

  function Failure({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
      <div className={styles.failure} role="alert">
        <p className={styles.error}>{error}</p>
        <Button onClick={onRetry} scale={2}>
          Try again
        </Button>
      </div>
    );
  }

  function Lineup({
    plan,
    decided,
    occupants,
    error,
    onRetry,
  }: {
    plan: PlanShape | null;
    decided: DecidedShape[];
    occupants: OccupantShape[];
    error: string | null;
    onRetry: () => void;
  }) {
    const listRef = useRef<HTMLUListElement>(null);
    // The plan's decisions win once it lands, so a late stream line cannot
    // leave a row showing something the round did not use.
    const rows = lineupRows(plan ? plan.decisions : decided, occupants);
    const done = decidedCount(rows);
    useEffect(() => {
      // Only the row that just filled in. Restaggering the whole list on
      // every arrival would blink the five already on screen.
      const rows = listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>("li[data-decided='true']")] : [];
      const latest = rows[rows.length - 1];
      if (latest) void staggerIn([latest]);
    }, [decided.length]);


    return (
      <NinePatch sprite="bg" data-anim="lineup">
        <h2 className={styles.sideHead}>Who is in</h2>
        <p className={styles.sideNote}>
          {plan
            ? `${plan.decisions.filter((d) => d.enter).length} of ${plan.decisions.length} are in. ${plan.bots} house bots fill the rest.`
            : `Your agents are checking their wallets. ${done} of ${rows.length} have answered.`}
        </p>
        <ul ref={listRef} className={styles.lineup}>
          {rows.map((row) => (
            <li key={row.agentId} className={styles.agentRow} data-decided={row.state === "decided" ? "true" : "false"}>
              <div className={styles.agentPortrait}>
                <img
                  className={`${styles.faceset} ${row.state === "waiting" ? styles.thinkingFace : ""}`}
                  src={facesetPath(row.face ?? characterFor(row.agentId))}
                  alt=""
                  width={38}
                  height={38}
                />
              </div>
              <div className={styles.agentBody}>
                <span className={styles.agentLine}>
                  <span className={styles.agentName}>
                    {row.name}{" "}
                    {row.state === "decided" ? (
                      <span className={row.decision.enter ? styles.in : styles.agentVerdict}>{row.decision.enter ? "is in" : "sits out"}</span>
                    ) : (
                      <span className={styles.agentVerdict}>thinking</span>
                    )}
                  </span>
                  {/* What it holds and what it owes, kept apart. A balance and
                      a debt read as one number if they share a colour, and an
                      agent playing on borrowed chips is the thing worth
                      seeing. Only drawn when the bank is on. */}
                  {row.state === "decided" && row.decision.balance !== undefined && (
                    <span className={styles.purse}>
                      <span className={styles.holds}>{row.decision.balance} chips</span>
                      {row.decision.debt ? <span className={styles.owes}>owes {row.decision.debt}</span> : null}
                    </span>
                  )}
                </span>
                {row.state === "decided" ? <Dialog scale={2}>{row.decision.reason}</Dialog> : <div className={styles.thinkingBubble} aria-label="thinking" />}
              </div>
            </li>
          ))}
        </ul>
        {error && <Failure error={error} onRetry={onRetry} />}
      </NinePatch>
    );
  }

  /**
   * The buy ins landing, one at a time, while the round settles.
   *
   * This was a frozen "Locked in" for 68.9 seconds. Collecting entries is
   * sequential by necessity, because each send waits for its own receipt
   * before the next nonce is requested. The wait is the same length; what
   * changed is that the agents are now visibly paying in, with their real
   * transactions on screen, instead of nothing happening.
   *
   * Real confirmations drive this. Nothing here is on a timer.
   */
  function BuyIns({ plan, entries, error, onRetry }: { plan: PlanShape | null; entries: EntryShape[]; error: string | null; onRetry: () => void }) {
    const expected = plan ? plan.decisions.filter((d) => d.enter) : [];
    const paid = new Map(entries.map((e) => [e.agentId, e]));
    // The round's lending, in the order it happened, on the screen where the
    // money moves. Staggered as a sequence rather than appearing at once,
    // because an ask and its answer read as an exchange only in that order.
    // The latest exchanges, not every one of them. Six agents can ask in one
    // round and the panel cannot grow, so a clipped list would cut off the
    // answer to the last question rather than the first.
    const beats = plan?.bank ? loanBeats(plan.loans ?? [], plan.refusals ?? []).slice(-BUYIN_BEATS) : [];
    const beatsRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
      const rows = beatsRef.current ? [...beatsRef.current.querySelectorAll<HTMLElement>("li")] : [];
      if (rows.length > 0) void staggerIn(rows);
    }, [beats.length]);

    return (
      <NinePatch sprite="bg" data-anim="buyins" className={styles.hud}>
        <h2 className={styles.sideHead}>Buying in</h2>
        <p className={styles.sideNote}>
          {entries.length < expected.length
            ? `${entries.length} of ${expected.length} have paid the pot. Each one is a real transaction.`
            : `All ${expected.length} are in. Spinning the reels.`}
        </p>
        {beats.length > 0 && (
          <ul ref={beatsRef} className={styles.beatList} aria-label="what Marrow did this round">
            {beats.map((beat) => (
              <li key={beat.key} className={styles.ruling} data-beat={beat.kind}>
                <span className={styles.rulingLine}>{beat.line}</span>
                {beat.aside && <span className={styles.rulingReason}>{beat.aside}</span>}
              </li>
            ))}
          </ul>
        )}
        <ul className={styles.lineup}>
          {expected.map((d) => {
            const entry = paid.get(d.agentId);
            return (
              <li key={d.agentId} className={styles.agentRow} data-paid={entry ? "true" : "false"}>
                <div className={styles.agentPortrait}>
                  <img className={`${styles.faceset} ${entry ? "" : styles.thinkingFace}`} src={facesetPath(characterFor(d.agentId))} alt="" width={38} height={38} />
                </div>
                <div className={styles.agentBody}>
                  <span className={styles.agentLine}>
                    <span className={styles.agentName}>
                      {d.name} <span className={entry ? styles.in : styles.agentVerdict}>{entry ? "paid in" : "buying in"}</span>
                    </span>
                  </span>
                  {entry ? (
                    <span className={styles.entryHash}>
                      {entry.link ? (
                        <a className={styles.transferHash} href={entry.link} target="_blank" rel="noreferrer">
                          {shortHash(entry.txHash)}
                        </a>
                      ) : (
                        <span className={styles.dim}>{shortHash(entry.txHash)}</span>
                      )}
                    </span>
                  ) : (
                    <div className={styles.thinkingBubble} aria-label="waiting for the chain" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {error && <Failure error={error} onRetry={onRetry} />}
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

  /**
   * A seat being emptied, given the room it deserves.
   *
   * It stands between the arena and the result rather than appearing as a row
   * in the ledger, because an agent ending is not a line item. Everything here
   * is element local: the faces drain, a rule draws across each name, the
   * sentences arrive on a stagger and whoever takes the chair slides in beside
   * it. Nothing moves the stage, the page or a container, and no blur, shake
   * or rotation is used anywhere in it.
   */
  function WreckScreen({ run, onContinue }: { run: RunShape; onContinue: () => void }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const per = run.weiPerChip ? BigInt(run.weiPerChip) : 1n;
    const moments = wreckMoments(run.wrecks ?? [], run.replacements ?? [], per);

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;
      const pick = (name: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`[${name}]`)];
      const tombs = pick("data-tomb");
      const faces = pick("data-dead-face");
      const cuts = pick("data-cut");
      const lines = pick("data-tomb-line");
      const heirs = pick("data-heir");

      // Someone who asked for less motion gets the end state, not a slower
      // version of it. The wreck still reads: the faces are grey, the names
      // are struck through, the words are there.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        utils.set([...tombs, ...lines, ...heirs], { opacity: 1, scale: 1, x: 0, y: 0 });
        utils.set(faces, { "--drained": 1 });
        utils.set(cuts, { scaleX: 1 });
        return;
      }

      utils.set(tombs, { opacity: 0, scale: 0.97 });
      utils.set(lines, { opacity: 0, y: 8 });
      utils.set(heirs, { opacity: 0, x: 10 });
      utils.set(cuts, { scaleX: 0 });
      utils.set(faces, { "--drained": 0 });

      // One timeline, so the order is declared rather than raced: the slab
      // arrives, the colour leaves the face, the name is ruled off, what it
      // was is said, and only then does the next one sit down.
      const timeline = createTimeline({ defaults: { ease: "outQuad" } });
      timeline.add(tombs, { opacity: 1, scale: 1, duration: 320, delay: stagger(110) });
      timeline.add(faces, { "--drained": 1, duration: 760, ease: "inOutQuad", delay: stagger(110) }, "<-=140");
      timeline.add(cuts, { scaleX: 1, duration: 280, delay: stagger(110) }, "<-=520");
      timeline.add(lines, { opacity: 1, y: 0, duration: 300, delay: stagger(70) }, "<-=140");
      timeline.add(heirs, { opacity: 1, x: 0, duration: 420, delay: stagger(110) }, "-=60");
      return () => {
        timeline.pause();
      };
    }, [run]);

    return (
      <div ref={rootRef} className={styles.wreck} data-anim="wreck">
        <h2 className={styles.wreckHead}>{moments.length === 1 ? "A seat is empty" : `${moments.length} seats are empty`}</h2>
        <div className={styles.tombs}>
          {moments.map((m) => (
            <NinePatch key={m.walletId} sprite="bg" className={styles.tomb} data-tomb="">
              <img
                className={styles.tombFace}
                data-dead-face=""
                src={facesetPath(m.face ?? characterFor(m.walletId))}
                alt=""
                width={38 * 2}
                height={38 * 2}
              />
              <div className={styles.tombNameRow}>
                <h3 className={styles.tombName}>{m.name}</h3>
                <span className={styles.cut} data-cut="" aria-hidden="true" />
              </div>
              <p className={styles.tombCause} data-tomb-line="">
                It {m.cause}.
              </p>
              <p className={styles.tombLife} data-tomb-line="">
                {m.life}
              </p>
              {m.toll && (
                <p className={styles.tombToll} data-tomb-line="">
                  {m.toll}
                </p>
              )}
              {m.heir && (
                <div className={styles.heir} data-heir="">
                  <img className={styles.heirFace} src={facesetPath(m.heir.face ?? characterFor(m.walletId))} alt="" width={38} height={38} />
                  <div className={styles.heirWords}>
                    <p className={styles.heirArrival}>{m.heir.arrival}</p>
                    <p className={styles.heirStaked}>{m.heir.staked}</p>
                  </div>
                </div>
              )}
            </NinePatch>
          ))}
        </div>
        <div className={styles.wreckFooter}>
          <Button onClick={onContinue}>Carry on</Button>
        </div>
      </div>
    );
  }

  /**
   * The wall, one page at a time.
   *
   * A graveyard only grows, and the stage is a fixed 1280 by 720 that does not
   * scroll, so this pages rather than lets a list run off the bottom. Eight
   * slabs fill the wall and the count says where in the whole they sit.
   */
  function Graveyard({ graves, error, onClose }: { graves: GraveShape[] | null; error: string | null; onClose: () => void }) {
    const [page, setPage] = useState(0);
    const wallRef = useRef<HTMLDivElement>(null);
    const shown = graveyardPage(graves ?? [], page);

    useEffect(() => {
      const slabs = wallRef.current ? [...wallRef.current.querySelectorAll<HTMLElement>("[data-grave]")] : [];
      void staggerIn(slabs, { grid: [4, 2] });
    }, [graves, shown.page]);

    return (
      <div className={`${styles.graveyard} ${styles.fill}`} data-anim="graveyard">
        <div className={styles.graveHead}>
          <h2 className={styles.graveTitle}>The graveyard</h2>
          <span className={styles.graveCount}>{shown.label}</span>
          <div className={styles.graveNav}>
            <Button onClick={() => setPage(shown.page + 1)} disabled={!shown.hasOlder} scale={2}>
              Older
            </Button>
            <Button onClick={() => setPage(shown.page - 1)} disabled={!shown.hasNewer} scale={2}>
              Newer
            </Button>
            <Button onClick={onClose} scale={2}>
              Back
            </Button>
          </div>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {graves === null && !error ? (
          <p className={styles.graveEmpty}>Reading the wall.</p>
        ) : shown.total === 0 ? (
          <p className={styles.graveEmpty}>Nobody has been carried out yet. Give it a few rounds.</p>
        ) : (
          <div ref={wallRef} className={styles.wall}>
            {shown.rows.map((g) => (
              <NinePatch key={`${g.identityId}-${g.at}`} sprite="bg" className={styles.grave} data-grave="">
                <img className={styles.graveFace} src={facesetPath(g.face ?? characterFor(g.walletId))} alt="" width={38 * 2} height={38 * 2} />
                <h3 className={styles.graveName}>{g.name}</h3>
                <p className={styles.graveCause}>{g.cause}</p>
                <dl className={styles.graveStats}>
                  <div className={styles.graveStat}>
                    <dt>rounds</dt>
                    <dd>{g.roundsSurvived}</dd>
                  </div>
                  <div className={styles.graveStat}>
                    <dt>wins</dt>
                    <dd>{g.wins}</dd>
                  </div>
                  <div className={styles.graveStat}>
                    <dt>best</dt>
                    <dd>{g.peakBalance}</dd>
                  </div>
                  <div className={`${styles.graveStat} ${styles.graveDebt}`}>
                    <dt>owed</dt>
                    <dd>{g.debtAtDeath}</dd>
                  </div>
                </dl>
              </NinePatch>
            ))}
          </div>
        )}
        {shown.total > GRAVES_PER_PAGE && <p className={styles.graveNote}>Newest first. The wall keeps everyone.</p>}
      </div>
    );
  }

  function ResultScreen({ run, onPlayAgain }: { run: RunShape; onPlayAgain: () => void }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const coinPathRef = useRef<SVGPathElement>(null);
    const prize = BigInt(run.potWei) - BigInt(run.rakeWei);
    const note = reconciliationNote(run.reconciled, run.checks);
    // Chips, not wei. Nobody can read 10000000000000, and the agents are no
    // longer speaking in it either.
    const per = run.weiPerChip ? BigInt(run.weiPerChip) : 1n;
    const chips = (wei: bigint): string => {
      const whole = wei < 0n ? -wei / per : wei / per;
      return `${wei < 0n ? "-" : ""}${whole}`;
    };
    const meters = swingMeters(run.agents.map((a) => ({ agentId: a.agentId, changeWei: BigInt(a.balanceAfterWei) - BigInt(a.balanceBeforeWei) })));
    const banked = run.transfers.some((t) => BANK_KINDS.has(t.kind));
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
          <p className={styles.winnerPot}>{chips(prize)} chips taken</p>
          {/* What a winner owed comes off the top, before it is treated as
              keeping anything. Three figures rather than one net number,
              because a win that mostly went to the lender is a different
              story from a win that did not. */}
          {run.repayment && (
            <div className={styles.garnish} data-anim="garnish">
              <p className={styles.garnishLine}>
                {run.repayment.name} owed Marrow <strong>{chips(BigInt(run.repayment.paidWei))}</strong> chips.
              </p>
              <p className={styles.garnishSplit}>
                {chips(BigInt(run.repayment.interestWei))} interest and {chips(BigInt(run.repayment.principalWei))} principal went straight back.
              </p>
              <p className={styles.garnishKept}>
                It kept <strong>{chips(prize - BigInt(run.repayment.paidWei))}</strong> chips.
              </p>
              {run.repayment.link && (
                <a className={styles.transferHash} href={run.repayment.link} target="_blank" rel="noreferrer">
                  the repayment on Basescan
                </a>
              )}
            </div>
          )}
          <p className={styles.sideNote}>{note.text}</p>
          {note.failed.length > 0 && (
            <ul className={styles.reconcileFails}>
              {note.failed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
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
                  {chips(change)}
                </span>
              </div>
            );
          })}
        </NinePatch>

        {/* A round with a lender moves twice as many chips: an advance and a
            repayment on top of the entries and the payout. Listed one under
            another they ran the screen off the bottom of a stage that does
            not scroll, so a banked round lays them in two columns. With the
            bank off there are no such rows and the panel is what it was. */}
        <NinePatch sprite="bg" className={`${styles.transfers} ${banked ? styles.transfersBanked : ""}`} data-anim="transfers">
          <h2 className={styles.sideHead}>Transfers</h2>
          <ul className={styles.transferList}>
            {transferRows(run.transfers).map((row) => (
              <li key={`${row.kind}-${row.label}`} className={styles.transferRow} data-transfer-row="">
                <span className={styles.transferLabel}>{row.label}</span>
                <span className={styles.transferAmount}>{chips(BigInt(row.amountWei))}</span>
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
