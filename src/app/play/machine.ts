// The one state machine for the player flow. Every screen transition goes
// through reduce(), so there is no screen deciding for itself whether it is
// allowed to be showing. A pure function, so the whole flow is testable
// without a browser.
//
//   connect -> modeSelect -> lobby -> slot -> spinning -> arena -> result
//                  ^                                                 |
//                  +-------------------- playAgain ------------------+
//
// spinning waits on two independent things: the reels finishing their stop
// sequence, and the server returning the settled round. They can land in
// either order, so both are tracked and the handoff happens when both are in.

import { GAME_MODES, type GameMode, type StakeTierId } from "@/config/modes";

export type Screen = "connect" | "modeSelect" | "lobby" | "slot" | "spinning" | "arena" | "result";

export interface Player {
  id: string;
  /** What to show in the corner: an address, a name, whatever identified them. */
  label: string;
}

/** The plan and run payloads are whatever the round routes return. */
export interface FlowState {
  screen: Screen;
  player: Player | null;
  mode: GameMode | null;
  stake: StakeTierId | null;
  plan: unknown | null;
  run: unknown | null;
  /** True only while a pull would be accepted. */
  leverLive: boolean;
  reelsSettled: boolean;
  error: string | null;
}

export type FlowEvent =
  | { type: "connected"; player: Player }
  | { type: "modeChosen"; modeId: string; stake: StakeTierId }
  | { type: "planLoaded"; plan: unknown }
  | { type: "leverPulled" }
  | { type: "reelsSettled" }
  | { type: "roundReady"; run: unknown }
  | { type: "playbackFinished" }
  | { type: "playAgain" }
  | { type: "failed"; message: string };

export function initialState(): FlowState {
  return { screen: "connect", player: null, mode: null, stake: null, plan: null, run: null, leverLive: false, reelsSettled: false, error: null };
}

/** Both halves of the handoff are in, so the arena can take over. */
function maybeHandoff(state: FlowState): FlowState {
  if (state.screen === "spinning" && state.reelsSettled && state.run !== null) {
    return { ...state, screen: "arena" };
  }
  return state;
}

export function reduce(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "connected":
      if (state.screen !== "connect") return state;
      return { ...state, screen: "modeSelect", player: event.player, error: null };

    case "modeChosen": {
      if (state.screen !== "modeSelect") return state;
      const mode = GAME_MODES.find((m) => m.id === event.modeId);
      if (!mode) return { ...state, error: `Unknown mode ${event.modeId}` };
      if (mode.locked) return { ...state, error: `${mode.name} is not open yet` };
      const stake = mode.stakes?.find((s) => s.id === event.stake);
      if (!stake) return { ...state, error: `Unknown stake tier for ${mode.name}` };
      return { ...state, screen: "lobby", mode, stake: stake.id, plan: null, run: null, reelsSettled: false, leverLive: false, error: null };
    }

    case "planLoaded":
      if (state.screen !== "lobby") return state;
      // The lever only comes alive once the player can see who is in and why.
      return { ...state, screen: "slot", plan: event.plan, leverLive: true, error: null };

    case "leverPulled":
      if (state.screen !== "slot" || !state.leverLive) return state;
      return { ...state, screen: "spinning", leverLive: false, reelsSettled: false, error: null };

    case "reelsSettled":
      if (state.screen !== "spinning") return state;
      return maybeHandoff({ ...state, reelsSettled: true });

    case "roundReady":
      if (state.screen !== "spinning") return state;
      return maybeHandoff({ ...state, run: event.run });

    case "playbackFinished":
      if (state.screen !== "arena") return state;
      return { ...state, screen: "result" };

    case "playAgain":
      if (state.screen !== "result") return state;
      return { ...state, screen: "modeSelect", plan: null, run: null, reelsSettled: false, leverLive: false, error: null };

    case "failed":
      // A failure must never strand the player: it drops back to the slot with
      // the lever live so they can pull again.
      if (state.screen === "connect" || state.screen === "modeSelect") return { ...state, error: event.message };
      return { ...state, screen: "slot", leverLive: true, reelsSettled: false, error: event.message };

    default:
      return state;
  }
}
