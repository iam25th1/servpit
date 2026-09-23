// @vitest-environment jsdom

// The lever, as a viewer meets it.
//
// The sentences themselves are worked out in leverNote.ts and tested there.
// What is checked here is that the quiet screen actually shows them, that the
// control is dead when the pit says a pull would be refused, and that a pull
// goes exactly once per press.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "@/render/manifest";
import { UiKitProvider } from "@/ui/UiKit";
import { GameShell, type GameShellProps, type LeverShape } from "./GameShell";
import { initialState, type FlowState } from "../machine";

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

const lever = (over: Partial<LeverShape> = {}): LeverShape => ({
  action: "Pull the lever",
  pulls: "3 pulls left.",
  reasoning: "The agents will reason about this round.",
  blocked: null,
  said: null,
  canPull: true,
  onPull: () => {},
  ...over,
});

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

describe("the lever on the quiet screen", () => {
  it("says what a pull costs and whether the round will reason, before it is pulled", () => {
    const { container } = mount(shell({ lever: lever() }));
    const text = container.textContent ?? "";
    expect(text).toContain("3 pulls left.");
    expect(text).toContain("The agents will reason about this round.");
    expect(text).toContain("Pull the lever");
  });

  it("says which thing is in the way, in the pit's own words", () => {
    const { container } = mount(shell({ lever: lever({ blocked: "The lever has started 6 rounds this hour, which is its limit." }) }));
    expect(container.textContent).toContain("6 rounds this hour");
  });

  it("is dead while the pit says a pull would be refused", () => {
    const onPull = vi.fn();
    const { container } = mount(shell({ lever: lever({ canPull: false, onPull }) }));
    const button = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Pull the lever"));
    expect(button?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button!);
    expect(onPull).not.toHaveBeenCalled();
  });

  it("asks once per press", () => {
    const onPull = vi.fn();
    const { container } = mount(shell({ lever: lever({ onPull }) }));
    const button = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Pull the lever"));
    fireEvent.click(button!);
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it("keeps the pit's answer on screen once it has one", () => {
    const { container } = mount(shell({ lever: lever({ said: "The pit heard you. The agents reason about this one." }) }));
    expect(container.textContent).toContain("The pit heard you");
  });

  it("is not there at all where a round is not something to ask for", () => {
    const { container } = mount(shell({ lever: null }));
    expect(container.textContent).not.toContain("Pull the lever");
  });
});
