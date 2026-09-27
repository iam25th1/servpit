// @vitest-environment jsdom

// Calling the agents, as a visitor meets it.
//
// The scoring is the server's and is tested there, with the same constants
// the panel states. What is checked here is the screen: every seat can be
// called in or out, a call is shown as a switch that stays down, the calls
// close while a round runs, each answer is marked against the call as it
// lands, and the result says how the read went.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "@/render/manifest";
import { UiKitProvider } from "@/ui/UiKit";
import { GameShell, type CallsShape, type GameShellProps } from "./GameShell";
import { initialState, type FlowState } from "../machine";
import { callSeats } from "../calls";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/assets/manifest.json"), "utf8")) as Manifest;

const watching = {
  live: true,
  error: null,
  resting: true,
  restReason: null,
  paused: false,
  nextRoundAt: new Date(Date.now() + 3_000_000).toISOString(),
  reasoning: "Agents ran on instinct last round.",
  replay: false,
  canReplay: false,
  last: null,
};

const calls = (over: Partial<CallsShape> = {}): CallsShape => ({
  seats: callSeats(null),
  draft: {},
  open: true,
  status: "Nothing called yet. Tap in or out for each agent.",
  callers: 0,
  onCall: () => {},
  ...over,
});

const shell = (extra: Partial<GameShellProps> = {}): GameShellProps =>
  ({
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
    bankEnabled: true,
    backing: null,
    board: null,
    onboarding: null,
    handle: { value: "ash", message: null, suggestions: [], checking: false, onClaim: () => {}, onChange: () => {} },
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
  }) as GameShellProps;

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

describe("the calls panel between rounds", () => {
  it("offers every seat in and out, with how it plays and the terms", () => {
    mount(shell({ calls: calls() }));
    for (const name of ["Atlas", "Blaze", "Comet", "Delta", "Ember", "Flint"]) {
      expect(screen.getByRole("button", { name: `${name} buys in` })).toBeTruthy();
      expect(screen.getByRole("button", { name: `${name} holds` })).toBeTruthy();
    }
    expect(document.body.textContent).toContain("Call the next round");
    expect(document.body.textContent).toContain("Careful. Wants a cushion before it plays.");
    expect(document.body.textContent).toMatch(/scores 10, or 20 when SERV made the decision/);
  });

  it("hands a call up and shows it as a switch that stays down", () => {
    const onCall = vi.fn();
    mount(shell({ calls: calls({ onCall, draft: { atlas: true } }) }));
    expect(screen.getByRole("button", { name: "Atlas buys in" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Atlas holds" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Blaze holds" }));
    expect(onCall).toHaveBeenCalledWith("blaze", false);
  });

  it("closes the calls while they are not being taken", () => {
    const onCall = vi.fn();
    mount(shell({ calls: calls({ onCall, open: false }) }));
    const button = screen.getByRole("button", { name: "Atlas buys in" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onCall).not.toHaveBeenCalled();
  });

  it("says how the last read went, on the card beside the calls", () => {
    mount(shell({ calls: calls(), readLine: "You read 5 of 6 right, for 50 points." }));
    expect(document.body.textContent).toContain("You read 5 of 6 right, for 50 points.");
  });

  it("is not offered over a replay, where there is nothing to call", () => {
    mount(shell({ calls: calls(), watching: { ...watching, replay: true } }));
    expect(screen.queryByRole("button", { name: "Atlas buys in" })).toBeNull();
  });
});

describe("the reveal, as the answers land", () => {
  const decided = [
    { agentId: "atlas", name: "Atlas", enter: false, stake: 0, reason: "Gut says hold.", source: "heuristic" as const, balance: 40, debt: 0, face: null },
    { agentId: "blaze", name: "Blaze", enter: true, stake: 10, reason: "I am in.", source: "serv" as const, balance: 90, debt: 0, face: null },
  ];

  it("marks each answer right or wrong against this viewer's call, and waits on the rest", () => {
    mount(
      shell({
        state: { ...initialState(), screen: "lobby" } as FlowState,
        decided,
        roundCalls: { atlas: true, blaze: true, comet: false },
      }),
    );
    expect(document.body.textContent).toContain("you called in, wrong");
    expect(document.body.textContent).toContain("you called in, right");
    // Comet has not answered, so its call is said without a verdict.
    expect(document.body.textContent).toContain("you called out");
    expect(document.body.textContent).not.toContain("you called out, ");
  });

  it("names the claimed fighters in the round, and which one is yours", () => {
    mount(
      shell({
        state: { ...initialState(), screen: "lobby" } as FlowState,
        decided,
        fighters: [
          { name: "Muffin", face: "Monk", entrantId: "fighter-cupcake" },
          { name: "Cinder", face: "Bear", entrantId: "fighter-ash" },
        ],
        myEntrantId: "fighter-cupcake",
      }),
    );
    expect(document.body.textContent).toContain("Also fighting:");
    expect(document.body.textContent).toContain("Muffin (yours)");
    expect(document.body.textContent).toContain("Cinder");
  });
});

describe("the result", () => {
  const run = {
    winner: "bot-12",
    potWei: "50000000000000",
    rakeWei: "0",
    payoutWei: "0",
    nextRolloverWei: "50000000000000",
    network: "fake",
    backend: "fake",
    settles: false,
    reconciled: true,
    weiPerChip: "1000000000000",
    agents: [],
    transfers: [],
    replay: { placements: ["bot-12"] },
  };

  it("says a house win paid nobody and what rolled on, how the read went and what SERV did", () => {
    mount(
      shell({
        state: { ...initialState(), screen: "result" } as FlowState,
        run: run as never,
        readLine: "You read 4 of 6 right, for 40 points.",
        servLine: "An instinct round: no SERV calls. A pulled round reasons.",
      }),
    );
    expect(document.body.textContent).toContain("House 13");
    expect(document.body.textContent).toContain("No payout. 50 chips roll on.");
    expect(document.body.textContent).toContain("You read 4 of 6 right, for 40 points.");
    expect(document.body.textContent).toContain("A pulled round reasons.");
  });
});

describe("the graveyard over a pit that runs itself", () => {
  it("opens over the pit, which it never did", () => {
    mount(shell({ graveyardOpen: true }));
    expect(document.body.textContent).toContain("The graveyard");
  });
});
