// @vitest-environment jsdom

// Claiming a fighter, as a visitor meets it.
//
// The rules themselves are the server's and are tested there. What is
// checked here is the panel: it asks for a name and a face, it will not ask
// for either before there is a handle, and once a seat is claimed the panel
// is the fighter rather than the form.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "@/render/manifest";
import { UiKitProvider } from "@/ui/UiKit";
import { GameShell, type FighterShape, type GameShellProps } from "./GameShell";
import { initialState, type FlowState } from "../machine";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/assets/manifest.json"), "utf8")) as Manifest;

const watching = {
  live: true,
  error: null,
  resting: true,
  restReason: null,
  paused: false,
  nextRoundAt: new Date(Date.now() + 120_000).toISOString(),
  reasoning: null,
  replay: false,
  canReplay: false,
  last: null,
};

const fighter = (over: Partial<FighterShape> = {}): FighterShape => ({
  mine: null,
  freeFaces: ["Monk", "Bear", "Dragon"],
  error: null,
  claiming: false,
  ready: true,
  onClaim: () => {},
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
    bankEnabled: false,
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

describe("claiming a fighter", () => {
  it("asks for a name and a face", () => {
    mount(shell({ fighter: fighter() }));
    expect(screen.getByLabelText("Claim a fighter and follow its career")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bear" })).toBeTruthy();
  });

  it("claims the name and the face that were chosen", () => {
    const onClaim = vi.fn();
    mount(shell({ fighter: fighter({ onClaim }) }));
    fireEvent.change(screen.getByLabelText("Claim a fighter and follow its career"), { target: { value: "Cinder" } });
    fireEvent.click(screen.getByRole("button", { name: "Bear" }));
    fireEvent.click(screen.getByRole("button", { name: "Claim this fighter" }));
    expect(onClaim).toHaveBeenCalledWith("Cinder", "Bear");
  });

  it("takes the first free face when nobody picks one", () => {
    const onClaim = vi.fn();
    mount(shell({ fighter: fighter({ onClaim }) }));
    fireEvent.change(screen.getByLabelText("Claim a fighter and follow its career"), { target: { value: "Cinder" } });
    fireEvent.click(screen.getByRole("button", { name: "Claim this fighter" }));
    expect(onClaim).toHaveBeenCalledWith("Cinder", "Monk");
  });

  it("asks for a handle first, because a claim is bound to one", () => {
    mount(shell({ fighter: fighter({ ready: false }) }));
    expect(screen.queryByLabelText("Claim a fighter and follow its career")).toBeNull();
    expect(document.body.textContent).toContain("Pick a handle first");
  });

  it("shows the fighter once there is one, rather than the form", () => {
    mount(shell({ fighter: fighter({ mine: { handle: "ash", name: "Cinder", face: "Monk", entrantId: "fighter-ash" } }) }));
    expect(document.body.textContent).toContain("Cinder is yours, and enters every round.");
    expect(screen.queryByRole("button", { name: "Claim this fighter" })).toBeNull();
  });

  it("says in the pit's own words when a claim is refused", () => {
    mount(shell({ fighter: fighter({ error: "Somebody took that face first. Pick another one." }) }));
    expect(document.body.textContent).toContain("took that face first");
  });
});
