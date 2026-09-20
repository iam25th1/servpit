// Lever state machine. Time arrives only through advance(deltaMs).
//
//   idle -> travelling -> (commit point passed) -> deadAir -> spinning
//        <- returning <-
//
// Two things here are deliberate and neither is decoration.
//
// The commit point sits partway down the travel. Before it the pull is still
// just a moving lever; after it the outcome is locked and further input does
// nothing. canPull goes false the instant travel starts, so the UI can show
// the lock rather than silently swallowing clicks.
//
// Dead air is the quiet between commit and the reels starting. Nothing is
// drawn differently and nothing moves. It is the pause where the player has
// committed and the machine has not answered yet, and removing it makes the
// pull feel like a button rather than a lever.

import type { SlotConfig } from "@/config/slot";

export type LeverState = "idle" | "travelling" | "deadAir" | "spinning" | "returning";

type Listener = () => void;

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Lever {
  private status: LeverState = "idle";
  private elapsedMs = 0;
  private travel = 0;
  private hasCommitted = false;
  private readonly commitListeners: Listener[] = [];
  private readonly releaseListeners: Listener[] = [];

  constructor(private readonly config: SlotConfig) {}

  get state(): LeverState {
    return this.status;
  }

  /** 0 at rest, 1 fully down. */
  get progress(): number {
    return this.travel;
  }

  /** True only when a fresh pull would be accepted. */
  get canPull(): boolean {
    return this.status === "idle";
  }

  /** True once the pull is locked in and input no longer matters. */
  get committed(): boolean {
    return this.hasCommitted;
  }

  onCommit(listener: Listener): () => void {
    this.commitListeners.push(listener);
    return () => {
      const i = this.commitListeners.indexOf(listener);
      if (i >= 0) this.commitListeners.splice(i, 1);
    };
  }

  onRelease(listener: Listener): () => void {
    this.releaseListeners.push(listener);
    return () => {
      const i = this.releaseListeners.indexOf(listener);
      if (i >= 0) this.releaseListeners.splice(i, 1);
    };
  }

  /** Returns false when the pull was ignored, so the caller can stay honest about it. */
  pull(): boolean {
    if (this.status !== "idle") return false;
    this.status = "travelling";
    this.elapsedMs = 0;
    this.travel = 0;
    this.hasCommitted = false;
    return true;
  }

  /** Sends the lever back up once the round has been handed off. */
  releaseToIdle(): void {
    if (this.status === "idle" || this.status === "returning") return;
    this.status = "returning";
    this.elapsedMs = 0;
  }

  advance(deltaMs: number): void {
    if (!(deltaMs > 0)) return;
    const l = this.config.lever;

    if (this.status === "travelling") {
      this.elapsedMs += deltaMs;
      const t = l.travelMs > 0 ? Math.min(1, this.elapsedMs / l.travelMs) : 1;
      this.travel = easeInOutCubic(t);
      if (!this.hasCommitted && t >= l.commitAt) {
        this.hasCommitted = true;
        for (const listener of [...this.commitListeners]) listener();
      }
      if (t >= 1) {
        this.travel = 1;
        this.status = "deadAir";
        this.elapsedMs = 0;
      }
      return;
    }

    if (this.status === "deadAir") {
      // Held down, not drifting: travel stays exactly where it stopped.
      this.elapsedMs += deltaMs;
      if (this.elapsedMs >= l.deadAirMs) {
        this.status = "spinning";
        this.elapsedMs = 0;
        for (const listener of [...this.releaseListeners]) listener();
      }
      return;
    }

    if (this.status === "returning") {
      this.elapsedMs += deltaMs;
      const t = l.returnMs > 0 ? Math.min(1, this.elapsedMs / l.returnMs) : 1;
      this.travel = 1 - easeInOutCubic(t);
      if (t >= 1) {
        this.travel = 0;
        this.status = "idle";
        this.hasCommitted = false;
        this.elapsedMs = 0;
      }
    }
  }
}
