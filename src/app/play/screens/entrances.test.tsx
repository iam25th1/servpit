// @vitest-environment jsdom

// An entrance happens on the way in, once.
//
// This is here because of a bug that shipped and ran on the live site for
// days: every screen in GameShell was declared inside it, so a countdown
// ticking once a second gave each of them a new identity, React rebuilt the
// subtree, and the entrance animation ran again. It read as a flicker once a
// second on the resting card and on everything else with a stagger.
//
// Reading the code did not catch it, and neither did any test, because both
// the animation and its dependencies were correct. What was wrong was the
// shape of the tree above them. So this mounts the real screens, lets the
// clock run for several seconds, and fails if any entrance runs twice or any
// container is replaced.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useState } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "@/render/manifest";
import { UiKitProvider } from "@/ui/UiKit";
import { GameShell, type GameShellProps } from "./GameShell";
import { initialState, type FlowState, type Screen } from "../machine";

const staggerIn = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const playTransition = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/ui/transitions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/transitions")>()),
  staggerIn,
  playTransition,
}));

/**
 * The real manifest, read from disk.
 *
 * A hand written one drifts: the kit throws when a sprite it asks for by name
 * is missing, and the screens between them ask for most of it.
 */
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
  canReplay: true,
  last: null,
};

const run = {
  winner: "agent-atlas",
  potWei: "60000000000000",
  rakeWei: "0",
  network: "fake",
  backend: "fake",
  settles: false,
  reconciled: true,
  weiPerChip: "1000000000000",
  checks: [],
  agents: [{ agentId: "atlas", name: "Atlas", balanceBeforeWei: "1000", balanceAfterWei: "2000" }],
  transfers: [],
  replay: { placements: ["agent-atlas"] },
} as unknown as GameShellProps["run"];

const state = (screen: Screen): FlowState => ({ ...initialState(), screen, run, player: { id: "p", label: "Guest session" } }) as FlowState;

function shell(screen: Screen, extra: Partial<GameShellProps> = {}): GameShellProps {
  return {
    state: state(screen),
    plan: null,
    run,
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

/**
 * A parent that re-renders once a second, which is what the client does.
 *
 * Without this the test proves nothing: the screens only rebuilt because
 * something above them rendered again, and a shell mounted on its own never
 * renders twice. Checked against the structure this replaced, where all five
 * of these fail.
 */
function Ticking({ props }: { props: GameShellProps }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  // The tick is on the wrapper rather than on the shell: what matters is
  // that something above renders again, not what it passes down.
  return (
    <div data-tick={tick}>
      <GameShell {...props} />
    </div>
  );
}

const mount = (props: GameShellProps) =>
  render(
    <UiKitProvider manifest={manifest}>
      <Ticking props={props} />
    </UiKitProvider>,
  );

beforeEach(() => {
  // jsdom has no matchMedia, and the result screen asks it whether motion is
  // welcome before it animates the coins. Reduced, so the test measures the
  // entrances rather than a coin arc.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  staggerIn.mockClear();
  playTransition.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Every screen that sits still while a clock runs underneath it. */
const STATIC_SCREENS: Array<{ name: string; props: GameShellProps; anchor: string }> = [
  { name: "the resting card", props: shell("resting"), anchor: "[data-anim='rest-card']" },
  { name: "the result screen", props: shell("result"), anchor: "[data-anim='winner-panel']" },
  { name: "the lineup", props: shell("lobby"), anchor: "[data-anim='lineup']" },
  { name: "the graveyard", props: shell("graveyard", { graves: [] }), anchor: "[data-anim='graveyard']" },
];

describe("an entrance runs once", () => {
  for (const screen of STATIC_SCREENS) {
    it(`does not run again on ${screen.name} while five seconds pass`, async () => {
      const { container } = mount(screen.props);
      const before = staggerIn.mock.calls.length;
      const anchor = container.querySelector(screen.anchor);
      expect(anchor, `${screen.name} did not render ${screen.anchor}`).not.toBeNull();

      await vi.advanceTimersByTimeAsync(5_000);

      // The same element, not a replacement that looks like it.
      expect(container.querySelector(screen.anchor)).toBe(anchor);
      expect(staggerIn.mock.calls.length, "an entrance ran again").toBe(before);
    });
  }

  it("keeps the countdown ticking while it does it", async () => {
    // The point is not a still screen. The text has to change, and only it.
    const { container } = mount(shell("resting"));
    const head = container.querySelector("[data-rest-row]");
    const first = head?.textContent ?? "";
    await vi.advanceTimersByTimeAsync(3_000);
    expect(container.querySelector("[data-rest-row]")).toBe(head);
    expect(head?.textContent).not.toBe(first);
  });
});
