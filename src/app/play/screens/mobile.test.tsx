// @vitest-environment jsdom

// The phone layout, at the sizes people hold.
//
// Two halves, because jsdom has no layout engine and cannot measure a pixel.
// What is checked here is what a phone gets and that it keeps behaving: the
// arrangement chosen for each size, and that the entrances still run once
// under a clock at phone size, which is where a rebuild would be most
// expensive. What the rules produce on a real engine, the overflow, the text
// sizes and the touch targets, is measured in a browser and pinned by the
// stylesheet guard next to this file.

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
vi.mock("@/ui/transitions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/transitions")>()),
  staggerIn,
}));

const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/assets/manifest.json"), "utf8")) as Manifest;

/** The sizes this is designed against, in css pixels. */
const PHONES = [
  { name: "iPhone SE, upright", width: 375, height: 667, layout: "portrait" },
  { name: "iPhone 14, upright", width: 390, height: 844, layout: "portrait" },
  { name: "Pixel 7, upright", width: 412, height: 915, layout: "portrait" },
  { name: "Galaxy S, upright", width: 360, height: 800, layout: "portrait" },
  { name: "iPad, upright", width: 768, height: 1024, layout: "portrait" },
  { name: "iPhone 14, sideways", width: 844, height: 390, layout: "compact" },
  { name: "iPhone SE, sideways", width: 667, height: 375, layout: "compact" },
  { name: "a laptop", width: 1440, height: 900, layout: "desktop" },
] as const;

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

const backing = {
  window: true,
  open: true,
  closesAt: new Date(Date.now() + 30_000).toISOString(),
  options: [{ agentId: "atlas", name: "Atlas", face: "Knight", characterId: "Knight", tier: "common", backers: 1 }],
  backers: 1,
  handle: "ash",
  pick: null,
  error: null,
  outcome: null,
};

function shell(screen: Screen, extra: Partial<GameShellProps> = {}): GameShellProps {
  return {
    state: { ...initialState(), screen, run, player: { id: "p", label: "Guest session" } } as FlowState,
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

/** A parent that renders again every second, the way the client does. */
function Ticker({ props }: { props: GameShellProps }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div data-tick={tick}>
      <GameShell {...props} />
    </div>
  );
}

function sizeTo(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event("resize"));
}

const mount = (props: GameShellProps) =>
  render(
    <UiKitProvider manifest={manifest}>
      <Ticker props={props} />
    </UiKitProvider>,
  );

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  staggerIn.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("what each size gets", () => {
  for (const phone of PHONES) {
    it(`gives ${phone.name} the ${phone.layout} layout`, () => {
      sizeTo(phone.width, phone.height);
      const { container } = mount(shell("resting"));
      expect(container.querySelector("main")?.getAttribute("data-layout")).toBe(phone.layout);
    });
  }
});

describe("every screen at phone size", () => {
  const SCREENS: Array<{ name: string; props: GameShellProps }> = [
    { name: "the lineup", props: shell("lobby") },
    { name: "the backing picker", props: shell("lobby", { backing: backing as unknown as GameShellProps["backing"] }) },
    { name: "the arena", props: shell("arena") },
    { name: "the result", props: shell("result") },
    { name: "the resting card", props: shell("resting") },
    { name: "the graveyard", props: shell("graveyard") },
    { name: "the leaderboard", props: shell("resting", { board: { rows: [{ handle: "ash", points: 400, picks: 3, correct: 1, streak: 1, best: 1 }], page: 1, pages: 1, total: 1, you: null } }) },
    { name: "how it works", props: shell("resting", { onboarding: [{ title: "Six agents, one pit", lines: ["Six AI agents hold their own wallets."] }] }) },
  ];

  for (const screen of SCREENS) {
    it(`draws ${screen.name} in the portrait layout`, () => {
      sizeTo(390, 844);
      const { container } = mount(screen.props);
      const main = container.querySelector("main");
      expect(main?.getAttribute("data-layout")).toBe("portrait");
      // Something rendered, rather than an empty shell that cannot overflow
      // because it has nothing in it.
      expect((main?.textContent ?? "").length).toBeGreaterThan(20);
    });

    it(`draws ${screen.name} sideways too`, () => {
      sizeTo(844, 390);
      const { container } = mount(screen.props);
      expect(container.querySelector("main")?.getAttribute("data-layout")).toBe("compact");
    });
  }
});

describe("the flicker fix holds at phone size", () => {
  it("runs an entrance once on a phone while five seconds pass", async () => {
    sizeTo(390, 844);
    const { container } = mount(shell("resting"));
    const card = container.querySelector("[data-anim='rest-card']");
    const before = staggerIn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(container.querySelector("[data-anim='rest-card']")).toBe(card);
    expect(staggerIn.mock.calls.length).toBe(before);
  });

  it("keeps the layout it was given while the clock runs", async () => {
    sizeTo(390, 844);
    const { container } = mount(shell("resting"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(container.querySelector("main")?.getAttribute("data-layout")).toBe("portrait");
  });
});
