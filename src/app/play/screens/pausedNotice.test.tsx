// @vitest-environment jsdom

// The paused notice, as a viewer meets it.
//
// A pit that cannot pay for a round shows the last round that finished under
// a plain notice, rather than a round of retirements every few minutes. The
// badge and the countdown say the same thing, and the lever is not offered.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "@/render/manifest";
import { UiKitProvider } from "@/ui/UiKit";
import { GameShell, type GameShellProps } from "./GameShell";
import { initialState, type FlowState } from "../machine";
import { liveBadge } from "./liveBadge";
import { leverLines } from "../leverNote";
import { watchState, type ArenaFeedRound, type ArenaFeedView } from "../arenaScreens";


const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/assets/manifest.json"), "utf8")) as Manifest;

const watching = {
  live: true,
  error: null,
  resting: true,
  restReason: null,
  paused: false,
  nextRoundAt: new Date(Date.now() + 120_000).toISOString(),
  reasoning: "Agents ran on instinct last round.",
  replay: false,
  canReplay: false,
  last: null,
};

function shell(extra: Partial<GameShellProps> = {}): GameShellProps {
  return {
    state: { ...initialState(), screen: "resting", player: { id: "p", label: "Guest session" } } as FlowState,
    plan: null,
    run: null,
    muted: true,
    leverNote: "",
    arena: { standing: 24, downed: [] },
    entries: [],
    decided: [],
    occupants: [],
    watching,
    graves: [],
    slotCanvasRef: { current: null },
    arenaCanvasRef: { current: null },
    bankEnabled: false,
    backing: null,
    board: null,
    onboarding: null,
    probeSymbol: () => null,
    onChooseMode: () => {},
    onRetry: () => {},
    onPull: () => {},
    onShowGraveyard: () => {},
    onCloseGraveyard: () => {},
    onWreckSeen: () => {},
    onReplay: () => {},
    onLeaveReplay: () => {},
    onBack: () => {},
    onHandle: () => {},
    onShowBoard: () => {},
    onCloseBoard: () => {},
    onBoardPage: () => {},
    onShowHow: () => {},
    onCloseHow: () => {},
    onPlayAgain: () => {},
    onToggleMute: () => {},
    ...extra,
  } as GameShellProps;
}

const mount = (props: GameShellProps) =>
  render(
    <UiKitProvider manifest={manifest}>
      <GameShell {...props} />
    </UiKitProvider>,
  );

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  });
});

afterEach(() => cleanup());

const REASON = "The pit is paused because the bank and the operator are out of funds. It starts again on its own once they are topped up.";

describe("the paused notice", () => {
  it("heads the resting card with the notice and the worker's reason, said once", () => {
    const { container, getAllByText } = mount(shell({ watching: { ...watching, restReason: REASON, hold: { kind: "funds", reason: REASON } } as GameShellProps["watching"] }));
    expect(getAllByText("Pit paused: out of funds.").length).toBeGreaterThan(0);
    const notice = container.querySelector('[data-hold="funds"]');
    expect(notice?.textContent).toBe(REASON);
    // The reason is on the resting mark as well; it is shown once.
    expect(container.textContent?.split(REASON).length).toBe(2);
    expect(container.textContent).not.toMatch(/sitting this one out/);
  });

  it("says so on the badge", () => {
    expect(liveBadge({ live: true, error: null, resting: true, paused: false, replay: false, hold: { kind: "funds" } })).toEqual({ text: "pit paused: out of funds", tone: "waiting" });
    expect(liveBadge({ live: true, error: null, resting: true, paused: false, replay: false, hold: { kind: "retirements" } }).text).toBe("pit paused: retirement limit reached");
    // The operator's own pause still reads as it did.
    expect(liveBadge({ live: true, error: null, resting: true, paused: true, replay: false, hold: { kind: "funds" } }).text).toBe("the pit is paused");
  });

  it("says so under the lever, whoever is asking, instead of counting pulls", () => {
    const lever = { view: { queued: false, message: "", left: 3, resetsAt: null, willReason: false, reasonBlocked: null }, error: null, pulling: false, busy: false, handle: "ash", now: 0 };
    expect(leverLines({ ...lever, held: "funds" }).blocked).toBe("The pit is paused until it is funded. The lever comes back when it plays again.");
    expect(leverLines({ ...lever, handle: null, held: "funds" }).blocked).toMatch(/paused until it is funded/);
    expect(leverLines({ ...lever, held: "retirements" }).blocked).toMatch(/retirement limit/);
    expect(leverLines({ ...lever, held: null }).blocked).toBeNull();
  });

  it("is gone the moment the hold lifts", () => {
    const { container } = mount(shell({ watching: { ...watching, hold: null } as GameShellProps["watching"] }));
    expect(container.textContent).not.toMatch(/Pit paused/);
    expect(container.querySelector("[data-hold]")).toBeNull();
  });
});

describe("what a spectator is shown while held", () => {
  const finished = { roundId: "r-last", phase: "resting", phases: [{ phase: "result", at: "2026-11-09T17:52:00.000Z" }, { phase: "resting", at: "2026-11-09T18:00:00.000Z", reason: REASON }], result: { winner: "agent-atlas" } } as unknown as ArenaFeedRound;
  const view = (hold: ArenaFeedView["pit"]["hold"]): ArenaFeedView => ({
    pit: { network: "fake", backend: "fake", paused: false, nextRoundAt: null, updatedAt: "", hold },
    round: { ...finished, result: undefined } as unknown as ArenaFeedRound,
    last: { ...finished, phase: "result" } as unknown as ArenaFeedRound,
  });

  it("is the last finished round, whole, with the hold beside it", () => {
    const state = watchState(view({ kind: "funds", since: "2026-11-09T18:00:00.000Z", reason: REASON }));
    expect(state.screen).toBe("resting");
    expect(state.round?.roundId).toBe("r-last");
    expect(state.round?.result).toBeDefined();
    expect(state.hold?.kind).toBe("funds");
  });

  it("carries no hold when there is none", () => {
    expect(watchState(view(null)).hold).toBeNull();
    expect(watchState(null).hold).toBeNull();
  });
});
