// @vitest-environment jsdom

// A visitor whose handle is taken has to be able to get out of it.
//
// This is the bug the flow shipped with: the handle was kept the moment it
// was typed and checked by nobody, so somebody who chose a name another
// browser holds was told "backing as ash" over a server that refused every
// write under it, with no field left to change and nothing to change it to.
//
// So the whole path is driven here, through the real hook and the real
// panel: type a taken name, be refused, take one of the offered names
// instead, and end the same session with a handle that works.

import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "@/render/manifest";
import { UiKitProvider } from "@/ui/UiKit";
import { GameShell, type GameShellProps } from "./GameShell";
import { useHandleClaim } from "../handleFeed";
import { memoryStore } from "../backerId";
import { initialState, type FlowState } from "../machine";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/assets/manifest.json"), "utf8")) as Manifest;

const TOKEN = "11111111-1111-4111-8111-111111111111";

/** The pit, as far as this test is concerned: ash is somebody else's. */
const answers: Record<string, unknown> = {
  ash: { handle: "ash", state: "taken", message: "ash belongs to another browser. Take one of these instead, or try another name.", suggestions: ["ash-2", "ash-3"] },
  "ash-2": { handle: "ash-2", state: "free", message: "ash-2 is free.", suggestions: [] },
};

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

/** The shell with a live handle claim behind it, the way the client wires it. */
function Harness({ initial }: { initial: string | null }) {
  const [store] = useState(() => memoryStore());
  const claim = useHandleClaim(store, TOKEN, initial);
  const props = {
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
    handle: {
      value: claim.handle,
      message: claim.message,
      suggestions: claim.suggestions,
      checking: claim.checking,
      onClaim: (raw: string) => void claim.claim(raw),
      onChange: claim.change,
    },
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
  } as unknown as GameShellProps;
  return (
    <UiKitProvider manifest={manifest}>
      <GameShell {...props} />
    </UiKitProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  });
  vi.stubGlobal("fetch", async (url: string) => {
    const name = new URL(url, "http://pit.test").searchParams.get("handle") ?? "";
    const body = answers[name] ?? { handle: name, state: "free", message: `${name} is free.`, suggestions: [] };
    return { ok: true, json: async () => body } as unknown as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (value: string) => fireEvent.change(screen.getByLabelText("Pick a handle"), { target: { value } });

describe("choosing a handle", () => {
  it("keeps the field, says who holds the name, and offers free ones", async () => {
    render(<Harness initial={null} />);
    type("ash");
    fireEvent.click(screen.getByRole("button", { name: "Use this handle" }));

    await waitFor(() => expect(document.body.textContent).toMatch(/belongs to another browser/));
    // The whole point: the field is still there, and there is something to press.
    expect(screen.getByLabelText("Pick a handle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ash-2" })).toBeTruthy();
  });

  it("lets the visitor recover in the same session, by taking one of them", async () => {
    render(<Harness initial={null} />);
    type("ash");
    fireEvent.click(screen.getByRole("button", { name: "Use this handle" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ash-2" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "ash-2" }));
    await waitFor(() => expect(document.body.textContent).toContain("You are ash-2."));
    expect(screen.queryByLabelText("Pick a handle")).toBeNull();
  });

  it("lets the visitor type a different name instead of taking a suggestion", async () => {
    render(<Harness initial={null} />);
    type("ash");
    fireEvent.click(screen.getByRole("button", { name: "Use this handle" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/belongs to another browser/));

    type("cinder");
    fireEvent.click(screen.getByRole("button", { name: "Use this handle" }));
    await waitFor(() => expect(document.body.textContent).toContain("You are cinder."));
  });

  it("gives the field back to anybody already holding a name the pit refuses", async () => {
    // The visitors this bug already caught: their browser kept ash, and the
    // pit has never agreed. One check on the way in puts them back in the
    // flow rather than leaving them stuck.
    render(<Harness initial="ash" />);
    await waitFor(() => expect(screen.getByLabelText("Pick a handle")).toBeTruthy());
    expect(document.body.textContent).toMatch(/belongs to another browser/);
  });

  it("keeps a name that is this browser's own", async () => {
    answers["mine"] = { handle: "mine", state: "yours", message: "mine is yours on this browser.", suggestions: [] };
    render(<Harness initial="mine" />);
    await waitFor(() => expect(document.body.textContent).toContain("You are mine."));
    expect(screen.queryByLabelText("Pick a handle")).toBeNull();
  });

  it("offers a way back to the field for somebody who wants a different name", async () => {
    render(<Harness initial={null} />);
    type("cinder");
    fireEvent.click(screen.getByRole("button", { name: "Use this handle" }));
    await waitFor(() => expect(document.body.textContent).toContain("You are cinder."));

    fireEvent.click(screen.getByRole("button", { name: "Use another handle" }));
    expect(screen.getByLabelText("Pick a handle")).toBeTruthy();
  });

  it("says what is wrong with a name that is not one, without asking the pit", async () => {
    render(<Harness initial={null} />);
    type("no");
    fireEvent.click(screen.getByRole("button", { name: "Use this handle" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/3 to 16/));
    expect(screen.getByLabelText("Pick a handle")).toBeTruthy();
  });
});
