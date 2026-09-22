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
import { useLayoutMode } from "@/ui/Stage";
import { useWallClock } from "../arenaClock";
import { tierOf } from "@/config/roster";
import { Onboarding } from "./Onboarding";
import { SlotCanvas, usePixelFit } from "./SlotCanvas";
import type { OnboardingScreen } from "../onboarding";
import { useUiKit } from "@/ui/UiKit";
import { ninePatchStyle } from "@/ui/ninePatchGeometry";
import { uiScale } from "@/ui/tokens";
import { staggerIn } from "@/ui/transitions";
import type { FlowState } from "../machine";
import type { ArenaStanding } from "./arenaHud";
import { swingMeters } from "./bankrollMeter";
import { entrantLabel } from "./entrantLabel";
import { decidedCount, lineupRows, type DecidedShape, type OccupantShape } from "./lineupRows";
import { secondsUntil } from "../arenaScreens";
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

/** What the result screen says instead of a button, while the pit runs itself. */
/**
 * What the badge says, in order of what a viewer most needs to know.
 *
 * A replay outranks the connection: a recording on screen while the badge
 * reads watching live would be a lie about a money surface, whatever the
 * stream is doing underneath.
 */
function badgeText(watching: WatchingShape): string {
  if (watching.replay) return "replay of a finished round";
  return watching.error ?? (watching.live ? "watching live" : "reconnecting");
}

/** True while what is on screen is a recording rather than the pit. */
function watchingReplay(watching: WatchingShape | null): boolean {
  return watching?.replay === true;
}

function badgeStyle(watching: WatchingShape): string {
  if (watching.replay) return styles.replay;
  return watching.live && !watching.error ? styles.live : styles.offair;
}

/**
 * The only thing in this file a passing second may change.
 *
 * A countdown used to arrive as a prop from the top of the tree, so every tick
 * re-rendered the whole shell, and while the screens were declared inside it
 * that rebuilt them and ran their entrances again. The clock lives in here
 * now: a tick re-renders this leaf and the text it returns, and nothing above
 * it hears about it.
 */
function Ticking({ render }: { render: (now: number) => string }) {
  const now = useWallClock(true);
  return <>{render(now)}</>;
}

function nextRoundLine(watching: WatchingShape, now: number): string {
  if (watching.paused) return "The pit is closed for now.";
  const seconds = secondsUntil(watching.nextRoundAt, now);
  if (seconds === null) return "The next round will start when the pit is ready.";
  if (seconds <= 0) return "The next round is starting.";
  return `Next round in ${seconds === 1 ? "a second" : `${seconds} seconds`}.`;
}

/** Chips from wei, for a screen that has no round of its own to divide by. */
function chipsOf(wei: bigint, weiPerChip: string | undefined): string {
  const per = weiPerChip ? BigInt(weiPerChip) : 1n;
  return String(wei < 0n ? -wei / per : wei / per);
}

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

/** What the pick interface draws, and what happened to this viewer's call. */
export interface BackingShape {
  /** True while the pit is in the backing phase, and this is not a replay. */
  window: boolean;
  /** True while a pick would still be taken: the phase and the clock agree. */
  open: boolean;
  closesAt: string | null;
  options: Array<{ agentId: string; name: string; face: string | null; characterId: string | null; tier: string | null; backers: number }>;
  /** How many viewers have backed anybody in this round. */
  backers: number;
  /** The name this browser backs under, or null until one is chosen. */
  handle: string | null;
  /** What this viewer backed in this round, or null. */
  pick: string | null;
  /** A plain sentence about the last pick that was refused, or null. */
  error: string | null;
  /** How the call went, once the round has a result. */
  outcome: { pick: string; won: boolean; points: number } | null;
}

/** A page of the points board. */
export interface BoardShape {
  rows: Array<{ handle: string; points: number; picks: number; correct: number; streak: number; best: number }>;
  page: number;
  pages: number;
  total: number;
  you: { handle: string; points: number; picks: number; correct: number; streak: number; best: number } | null;
}

/** The spectator's view of a pit that runs itself. */
export interface WatchingShape {
  /** True while the phase stream is connected. */
  live: boolean;
  /** A plain sentence when the pit cannot be reached, or null. */
  error: string | null;
  resting: boolean;
  restReason: string | null;
  paused: boolean;
  nextRoundAt: string | null;
  /** Whether this round's agents reasoned, in one sentence, or null. */
  reasoning: string | null;
  /** True while what is on screen is a recording, not the pit. */
  replay: boolean;
  /** Whether there is a finished round to watch again. */
  canReplay: boolean;
  last: Record<string, unknown> | null;
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
  /**
   * What the pit is doing, when the pit is running itself.
   *
   * Null in the lever flow, where the player starts the round and there is no
   * quiet between them to fill.
   */
  watching: WatchingShape | null;
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
  /** Watch the last finished round again, from the recording. */
  onReplay: () => void;
  onLeaveReplay: () => void;
  /** Backing, in arena mode only. Null in the lever flow, where it cannot exist. */
  backing: BackingShape | null;
  /** The points board, once a viewer asks for it. */
  board: BoardShape | null;
  onBack: (agentId: string) => void;
  onHandle: (handle: string) => void;
  onShowBoard: () => void;
  onCloseBoard: () => void;
  onBoardPage: (page: number) => void;
  /** The screens to show, or null when nothing is being explained. */
  onboarding: OnboardingScreen[] | null;
  onShowHow: () => void;
  onCloseHow: () => void;
  /**
   * The symbol drawn at this point of the slot canvas, in logical pixels, or
   * null. Only the client owns the reels, so only it can answer.
   */
  probeSymbol: (x: number, y: number) => string | null;
  onPlayAgain: () => void;
  onToggleMute: () => void;
}


/** A character and what it is worth knowing about it, in three words. */
function fighterLabel(id: string): string | null {
  const tier = tierOf(id);
  return tier === null ? null : `${id}, ${tier}`;
}

// The screens.
//
// At module scope, and this is not a style preference. Declared inside
// GameShell they were new function identities on every render of it, so React
// unmounted and remounted each one whenever anything above changed: a
// countdown ticking once a second rebuilt the resting card once a second,
// which ran its entrance animation again, which is the flicker. Measured on
// the live site as a one second cycle, and here as a brand new card element
// every thousand milliseconds.

function ModeSelect({ onChoose, error, bankEnabled, onShowGraveyard }: { onChoose: (modeId: string) => void; error: string | null; bankEnabled: boolean; onShowGraveyard: () => void }) {
  const { modeIcon } = useUiKit();
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
      {bankEnabled && (
        <div className={styles.menuFooter} data-anim="menu-footer">
          <Button onClick={onShowGraveyard} scale={2}>
            The graveyard
          </Button>
          <p className={styles.menuFooterNote}>Everyone who has been carried out.</p>
        </div>
      )}
    </>
  );
}

function EnterTab({ label, onSelect }: { label: string; onSelect: () => void }) {
  const { ui } = useUiKit();
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

/**
 * The pick interface, while the window is open.
 *
 * The lineup with what each agent drew and who is behind it, because
 * backing a fighter nobody has seen is a coin toss with extra steps. Points
 * only: nothing here moves a chip, and the line under the heading says so
 * where a viewer reads it rather than only in the README.
 */

function Backing({ backing, onBack, onHandle }: { backing: BackingShape; onBack: (agentId: string) => void; onHandle: (handle: string) => void }) {
  const { facesetPath } = useUiKit();
  const listRef = useRef<HTMLUListElement>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const rows = listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>("li")] : [];
    void staggerIn(rows, { delay: 60 });
  }, []);

  return (
    <NinePatch sprite="bg" data-anim="backing">
      <h2 className={styles.sideHead}>Back a fighter</h2>
      <p className={styles.sideNote}>
        {backing.open ? (
          <Ticking
            render={(now) => {
              const left = secondsUntil(backing.closesAt, now);
              return `Picks close in ${left === null ? "a moment" : left === 1 ? "a second" : `${left} seconds`}. Points only, never money.`;
            }}
          />
        ) : (
          "Picks are closed for this round."
        )}
      </p>
      {backing.handle === null ? (
        <form
          className={styles.handleRow}
          onSubmit={(event) => {
            event.preventDefault();
            onHandle(draft);
          }}
        >
          <label className={styles.handleLabel} htmlFor="backing-handle">
            Pick a handle to back under
          </label>
          <input
            id="backing-handle"
            className={styles.handleInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
          />
          <Button onClick={() => onHandle(draft)} scale={2}>
            Use this handle
          </Button>
        </form>
      ) : (
        <p className={styles.sideNote}>
          Backing as {backing.handle}. {backing.backers === 1 ? "1 viewer has" : `${backing.backers} viewers have`} picked so far.
        </p>
      )}
      <ul ref={listRef} className={styles.backList}>
        {backing.options.map((option) => (
          <li key={option.agentId} className={option.agentId === backing.pick ? `${styles.backRow} ${styles.backed}` : styles.backRow}>
            <img className={styles.faceset} src={facesetPath(option.face ?? characterFor(option.agentId))} alt="" width={38} height={38} />
            <div className={styles.backWho}>
              <span className={styles.backName}>{option.name}</span>
              <span className={styles.backDraw}>{option.characterId ? `${option.characterId}, ${option.tier}` : "waiting on the draw"}</span>
            </div>
            <span className={styles.backCount}>{option.backers === 1 ? "1 backer" : `${option.backers} backers`}</span>
            {/* A handle before a pick: without one the server would refuse
                it, and a button that only produces a refusal is a worse
                answer than a button that waits. */}
            <Button onClick={() => onBack(option.agentId)} scale={2} disabled={!backing.open || backing.handle === null}>
              {option.agentId === backing.pick ? "Backed" : "Back"}
            </Button>
          </li>
        ))}
      </ul>
      {backing.error && (
        <p className={styles.backError} role="status">
          {backing.error}
        </p>
      )}
    </NinePatch>
  );
}

/**
 * The points board.
 *
 * Handles are unverified, so this is a list of names that called rounds
 * right rather than a ranking of people, and the line at the bottom says
 * so on the screen rather than only in the README.
 */

function Board({ board, onClose, onPage }: { board: BoardShape; onClose: () => void; onPage: (page: number) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rows = rootRef.current ? [...rootRef.current.querySelectorAll<HTMLElement>("[data-board-row]")] : [];
    void staggerIn(rows, { delay: 40 });
  }, [board.page]);

  return (
    <div ref={rootRef} className={styles.boardOver} data-anim="board">
      <NinePatch sprite="panelAlt" scale={uiScale} className={styles.boardCard}>
        <h2 className={styles.graveTitle}>Who calls it right</h2>
        <p className={styles.sideNote}>
          {board.total === 1 ? "1 backer" : `${board.total} backers`}. Points, never money, and handles are unverified.
        </p>
        <ul className={styles.boardList}>
          {board.rows.map((row, i) => (
            <li key={row.handle} className={row.handle === board.you?.handle ? `${styles.boardRow} ${styles.boardYou}` : styles.boardRow} data-board-row="">
              <span className={styles.boardRank}>{(board.page - 1) * 10 + i + 1}</span>
              <span className={styles.boardHandle}>{row.handle}</span>
              <span className={styles.boardStat}>
                {row.correct} of {row.picks} called
              </span>
              <span className={styles.boardStat}>{row.streak > 0 ? `${row.streak} in a row` : "no run"}</span>
              <span className={styles.boardPoints}>{row.points}</span>
            </li>
          ))}
        </ul>
        {board.total === 0 && <p className={styles.sideNote}>Nobody has backed a round yet.</p>}
        {board.you && !board.rows.some((row) => row.handle === board.you?.handle) && (
          <p className={styles.sideNote}>
            You have {board.you.points} points from {board.you.picks} picks.
          </p>
        )}
        <div className={styles.restActions}>
          <Button onClick={() => onPage(board.page - 1)} scale={2} disabled={board.page <= 1}>
            Back a page
          </Button>
          <span className={styles.boardStat}>
            Page {board.page} of {board.pages}
          </span>
          <Button onClick={() => onPage(board.page + 1)} scale={2} disabled={board.page >= board.pages}>
            On a page
          </Button>
          <Button onClick={onClose} scale={2}>
            Close
          </Button>
        </div>
      </NinePatch>
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
  const { facesetPath } = useUiKit();
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
            {/* The face says what it is on hover and on a tap, in CSS
                rather than in state: these rows are rebuilt on every
                parent render, and a tooltip held in state is torn down by
                the rebuild the moment it is opened. */}
            <div className={styles.agentPortrait} tabIndex={0} aria-label={fighterLabel(row.face ?? characterFor(row.agentId)) ?? row.name}>
              <span className={styles.faceTip} aria-hidden="true">
                {fighterLabel(row.face ?? characterFor(row.agentId)) ?? ""}
              </span>
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
                  {/* Where the answer came from, in the two words that say
                      it: a line the fallback wrote must never read as
                      though an agent reasoned its way to it. */}
                  {row.state === "decided" && row.decision.source && (
                    <span className={row.decision.source === "serv" ? styles.reasoned : styles.instinct}>{row.decision.source === "serv" ? "reasoned" : "on instinct"}</span>
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
  const { facesetPath } = useUiKit();
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

function ArenaHud({ run, arena, backing }: { run: RunShape | null; arena: ArenaStanding; backing: BackingShape | null }) {
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
      {/* The call stays on screen for the whole fight, so a viewer can
          watch the one they backed rather than remember which it was. */}
      {backing?.pick && (
        <div className={styles.hudRow}>
          <span>Your pick</span>
          <span className={styles.hudPick}>{backing.pick}</span>
        </div>
      )}
      <div className={styles.hudRow}>
        <span>Pot</span>
        {/* Chips, like every other figure on screen. It printed raw wei,
            which is a fifteen digit number nobody can read at a glance,
            and a replay puts this panel in front of a visitor. */}
        <span className={styles.hudValue}>{run ? `${chipsOf(BigInt(run.potWei), run.weiPerChip)} chips` : "-"}</span>
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
/**
 * The quiet between rounds, which the lever flow never has.
 *
 * A pit that is doing nothing still has to say what it is doing and when it
 * will do it again, or a viewer cannot tell a schedule from a failure. The
 * countdown reads from the one wall clock in the client; everything else
 * here is the last round, which is over and gives nothing away.
 */

function Resting({
  watching,
  run,
  bank,
  onShowGraveyard,
  onReplay,
  onShowBoard,
  backingSoon,
  bankEnabled,
}: {
  watching: WatchingShape;
  run: RunShape | null;
  bank: BankShape | null;
  onShowGraveyard: () => void;
  onReplay: () => void;
  onShowBoard: () => void;
  /** True when the pit is going to open a window in the round it is about to play. */
  backingSoon: boolean;
  bankEnabled: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const winner = run ? entrantLabel(run.winner, run.agents) : null;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    void staggerIn([...root.querySelectorAll<HTMLElement>("[data-rest-row]")], { delay: 80 });
  }, [watching.nextRoundAt]);

  // A function of the moment rather than a number computed once, so the card
  // around it is never rebuilt to change a figure inside it.
  const headline = (now: number): string => {
    if (watching.paused) return "The pit is closed for now.";
    if (watching.restReason) return "The pit is sitting this one out.";
    const seconds = secondsUntil(watching.nextRoundAt, now);
    if (seconds === null) return "The pit is between rounds.";
    return seconds > 0 ? `Next round in ${seconds === 1 ? "a second" : `${seconds} seconds`}.` : "The next round is starting.";
  };

  return (
    <div ref={rootRef} className={styles.resting} data-anim="resting">
      <NinePatch sprite="panelAlt" scale={uiScale} className={styles.restCard} data-anim="rest-card">
        <h2 className={styles.restHead} data-rest-row="">
          <Ticking render={headline} />
        </h2>
        {watching.reasoning && (
          <p className={styles.restReason} data-rest-row="">
            {watching.reasoning}
          </p>
        )}
        {watching.restReason && (
          <p className={styles.restReason} data-rest-row="">
            {watching.restReason}
          </p>
        )}
        {winner && (
          <p className={styles.restLast} data-rest-row="">
            Last round: {winner} took {run ? chipsOf(BigInt(run.potWei) - BigInt(run.rakeWei), run.weiPerChip) : "0"} chips.
          </p>
        )}
        {/* When to come back. The window opens inside the next round rather
            than at a time of its own, so this says where in the round it
            is instead of inventing a clock for it. */}
        {backingSoon && (
          <p className={styles.restLast} data-rest-row="">
            Backing opens after the draw, once the next round is under way.
          </p>
        )}
        <div className={styles.restActions} data-rest-row="">
          {watching.canReplay && (
            <Button onClick={onReplay} scale={2}>
              Watch the last round
            </Button>
          )}
          <Button onClick={onShowBoard} scale={2}>
            The leaderboard
          </Button>
          {bankEnabled && (
            <Button onClick={onShowGraveyard} scale={2}>
              The graveyard
            </Button>
          )}
        </div>
      </NinePatch>

      {/* The lender, where it always is, so a viewer between rounds can see
          the treasury and the book without waiting for the next one. */}
      {bank && (
        <div className={styles.restBank} data-rest-row="">
          <BankPanel bank={bank} loans={[]} refusals={[]} />
        </div>
      )}
    </div>
  );
}

function WreckScreen({ run, onContinue }: { run: RunShape; onContinue: () => void }) {
  const { facesetPath } = useUiKit();
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
  const { facesetPath } = useUiKit();
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

function ResultScreen({ run, onPlayAgain, backing, watching }: { run: RunShape; onPlayAgain: () => void; backing: BackingShape | null; watching: WatchingShape | null }) {
  const { facesetPath, ui } = useUiKit();
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
        {/* What this viewer called, and what it was worth. Points, which
            are not money and cannot become money. */}
        {backing?.outcome && (
          <p className={backing.outcome.won ? styles.pickWon : styles.pickLost} data-anim="pick-result">
            You backed {backing.outcome.pick}.{" "}
            {backing.outcome.won ? `It won, and that is ${backing.outcome.points} points.` : "It did not win, so no points this round."}
          </p>
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
        {/* Watching a pit that runs itself, nothing a viewer presses starts
            a round. The button becomes the schedule it is waiting on. */}
        {watching ? (
          <p className={styles.nextRound}>
            <Ticking render={(now) => nextRoundLine(watching, now)} />
          </p>
        ) : (
          <Button onClick={onPlayAgain}>Another round</Button>
        )}
      </div>
    </div>
  );
}

/** The fight's canvas, fitted the same way the slot's is. */
function ArenaCanvas({ canvasRef, hidden, fitToWidth }: { canvasRef: RefObject<HTMLCanvasElement | null>; hidden: boolean; fitToWidth: boolean }) {
  usePixelFit(canvasRef, fitToWidth && !hidden);
  return <canvas ref={canvasRef} className={`${styles.canvas} ${hidden ? styles.hidden : ""}`} role="img" aria-label="Arena replay" />;
}

export function GameShell(props: GameShellProps) {
  // The canvases come out of props here rather than being read from them
  // inside the markup: a ref read in the middle of a render makes the compiler
  // treat every later props read as a ref read too.
  const { state, plan, run, decided, entries, occupants, slotCanvasRef, arenaCanvasRef } = props;
  // The arrangement, not a size: a phone gets its own layout rather than the
  // stage at a third. Every rule for it is scoped to this attribute.
  const layout = useLayoutMode();
  const showStage = state.screen === "lobby" || state.screen === "slot" || state.screen === "spinning" || state.screen === "arena";

  return (
    <main className={styles.shell} data-layout={layout}>
      <header className={styles.topbar} data-anim="topbar">
        <h1 className={styles.wordmark}>SERVPIT</h1>
        <div className={styles.topmeta}>
          {props.watching && (
            /* The badge says the connection, and when the pit has been out of
               reach long enough to be worth mentioning it says that instead.
               Here rather than on one screen, because a viewer can lose the
               pit during a fight as easily as between rounds. */
            <span className={badgeStyle(props.watching)} data-anim="live" role="status">
              {badgeText(props.watching)}
            </span>
          )}
          {/* Whether this round is being reasoned, beside the connection,
              because it is the other thing that is true of the whole round
              rather than of one screen. The rows say it per agent. */}
          {props.watching?.reasoning && <span className={styles.reasoningNote}>{props.watching.reasoning}</span>}
          {props.watching?.replay && (
            <Button onClick={props.onLeaveReplay} scale={2}>
              Back to the pit
            </Button>
          )}
          {/* The way back into the explanation, on every screen, because a
              visitor who arrives mid round is the one who needs it. */}
          <Button onClick={props.onShowHow} scale={2}>
            How it works
          </Button>
          {state.player && <span>{state.player.label}</span>}
          <Button onClick={props.onToggleMute} scale={2} aria-pressed={!props.muted}>
            {props.muted ? "Sound off" : "Sound on"}
          </Button>
        </div>
      </header>

      <div className={styles.body}>
      {state.screen === "modeSelect" && <ModeSelect onChoose={props.onChooseMode} error={state.error} bankEnabled={props.bankEnabled} onShowGraveyard={props.onShowGraveyard} />}
      {state.screen === "graveyard" && <Graveyard graves={props.graves} error={state.error} onClose={props.onCloseGraveyard} />}

      {/* The stage is always mounted so the canvases exist before the player
          reaches them; the engine builds against them during boot. Only its
          visibility changes. */}
      <div className={showStage ? styles.playfield : styles.offstage} aria-hidden={!showStage}>
          <div className={styles.cabinet}>
            <NinePatch sprite="panelAlt" data-anim="cabinet" style={{ padding: "var(--space-base)", position: "relative" }}>
              <SlotCanvas canvasRef={slotCanvasRef} hidden={state.screen === "arena"} probeSymbol={props.probeSymbol} labelFor={fighterLabel} fitToWidth={layout !== "desktop"} />
              <ArenaCanvas canvasRef={arenaCanvasRef} hidden={state.screen !== "arena"} fitToWidth={layout !== "desktop"} />
            </NinePatch>
            {state.screen !== "arena" && (
              <>
                <div className={styles.leverRow}>
                  <Button onClick={props.onPull} disabled={!state.leverLive}>
                    {state.screen === "lobby" ? "Agents deciding" : state.leverLive ? "Pull the lever" : "Agents buying in"}
                  </Button>
                  {/* What the three reels mean, beside the lever rather than
                      under it: the stage is a fixed 1280 by 720 and the
                      column has no spare height, but it has spare width. */}
                  <p className={styles.legend}>Reel one picks the fighter, reel two an ability, reel three a stat roll. Three matching faces pay a bonus.</p>
                </div>
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
            <ArenaHud run={run} arena={props.arena} backing={props.backing} />
          ) : state.screen === "spinning" ? (
            <BuyIns plan={plan} entries={entries} error={state.error} onRetry={props.onRetry} />
          ) : props.backing?.window ? (
            /* The pick interface stands where the lineup does, because it is
               the lineup with what each agent drew and who is behind it. */
            <Backing backing={props.backing} onBack={props.onBack} onHandle={props.onHandle} />
          ) : (
            <Lineup plan={plan} decided={decided} occupants={occupants} error={state.error} onRetry={props.onRetry} />
          )}
      </div>

      {state.screen === "resting" && props.watching && (
        <Resting
          watching={props.watching}
          run={run}
          bank={plan?.bank ?? null}
          onShowGraveyard={props.onShowGraveyard}
          onReplay={props.onReplay}
          onShowBoard={props.onShowBoard}
          backingSoon={props.backing !== null && !watchingReplay(props.watching)}
          bankEnabled={props.bankEnabled}
        />
      )}
      {props.board && <Board board={props.board} onClose={props.onCloseBoard} onPage={props.onBoardPage} />}
      {props.onboarding && <Onboarding screens={props.onboarding} onClose={props.onCloseHow} />}
      {state.screen === "wreck" && run && <WreckScreen run={run} onContinue={props.onWreckSeen} />}
      {state.screen === "result" && run && <ResultScreen run={run} onPlayAgain={props.onPlayAgain} backing={props.backing} watching={props.watching} />}
      </div>
    </main>
  );







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
