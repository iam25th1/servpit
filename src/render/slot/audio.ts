// Slot audio. The sink is injected so the cue logic can be tested without a
// browser; WebAudioSink is the real one.
//
// Two rules browsers force on us, and one that is taste.
//
// Browsers block audio until the page has had a user gesture, so this starts
// muted and unlocks on the first real interaction. A deliberate mute after
// that is never overridden by a later gesture.
//
// Taste: the payout is two samples, a sharp transient over a low body played
// together. One sample alone reads thin no matter how loud it is. The three
// reel stops are the same sample at rising pitch, so the stops read as a
// sequence closing rather than three identical clicks.

import type { AudioDef } from "../manifest";

export interface PlayOptions {
  /** Playback rate, which is also the pitch. */
  rate?: number;
  volume?: number;
}

export interface AudioSink {
  play(id: string, options?: PlayOptions): void;
  startLoop(id: string, options?: PlayOptions): void;
  stopLoop(id: string): void;
}

export interface SlotAudioOptions {
  muted?: boolean;
  storage?: Storage;
}

const STORAGE_KEY = "servpit:audio";

/** Rising pitch per reel, so the third stop sits highest. */
const REEL_STOP_RATES = [0.92, 1, 1.09];

export class SlotAudio {
  private readonly defs = new Map<string, AudioDef>();
  private readonly loops = new Set<string>();
  private isMuted: boolean;
  private unlocked = false;

  constructor(
    defs: readonly AudioDef[],
    private readonly sink: AudioSink,
    private readonly options: SlotAudioOptions = {},
  ) {
    for (const def of defs) this.defs.set(def.id, def);
    const stored = this.readStored();
    this.isMuted = stored ?? options.muted ?? true;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Call from a real user gesture. Does nothing after the first time. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.readStored() === null) this.setMuted(false);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) for (const id of [...this.loops]) this.stopLoop(id);
    try {
      this.options.storage?.setItem(STORAGE_KEY, muted ? "muted" : "on");
    } catch {
      // A blocked or full storage must never break the round.
    }
  }

  toggleMuted(): void {
    this.setMuted(!this.isMuted);
  }

  play(id: string, options?: PlayOptions): void {
    if (this.isMuted || !this.defs.has(id)) return;
    this.sink.play(id, options);
  }

  startLoop(id: string, options?: PlayOptions): void {
    const def = this.defs.get(id);
    if (this.isMuted || !def || !def.loop) return;
    this.loops.add(id);
    this.sink.startLoop(id, options);
  }

  stopLoop(id: string): void {
    if (!this.loops.has(id)) return;
    this.loops.delete(id);
    this.sink.stopLoop(id);
  }

  leverPull(): void {
    this.play("leverPull");
  }

  startSpin(): void {
    this.startLoop("reelSpin");
  }

  stopSpin(): void {
    this.stopLoop("reelSpin");
  }

  reelStop(index: number): void {
    this.play("reelStop", { rate: REEL_STOP_RATES[index] ?? 1 });
  }

  nearMiss(): void {
    this.play("nearMiss", { volume: 0.7 });
  }

  win(jackpot = false): void {
    this.play(jackpot ? "jackpotSting" : "winSting");
  }

  /** Sharp transient over a low body. Both at once, not in sequence. */
  payout(): void {
    this.play("payoutTransient", { rate: 1.12, volume: 0.9 });
    this.play("payoutBody", { rate: 0.82, volume: 0.75 });
  }

  select(): void {
    this.play("uiSelect", { volume: 0.6 });
  }

  locked(): void {
    this.play("uiLocked", { volume: 0.5 });
  }

  private readStored(): boolean | null {
    try {
      const raw = this.options.storage?.getItem(STORAGE_KEY);
      if (raw === "muted") return true;
      if (raw === "on") return false;
    } catch {
      // Private mode or blocked storage: fall through to the default.
    }
    return null;
  }
}
