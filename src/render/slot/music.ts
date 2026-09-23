// The bed under the pit.
//
// Its own thing rather than a cue on SlotAudio, for three reasons. It has its
// own switch, because somebody who wants the reels and the coins does not
// necessarily want a loop playing for an hour while a round is waiting. It
// changes with the pit rather than with an event: two tracks, one for a pit
// between rounds and one for a fight, and a phase that does not change the
// track must not restart it. And it sits under the cues at a fixed volume,
// because a bed that competes with a reel stop is a bed nobody wants.
//
// It starts silent like the rest of the audio, since browsers block sound
// until a gesture and an autoplaying loop is worse than no loop at all.

import type { AudioDef } from "../manifest";
import type { AudioSink } from "./audio";

/** What the pit is doing, as far as the music is concerned. */
export type MusicScene = "pit" | "fight";

/**
 * How loud the bed is against the cues.
 *
 * A third. Measured against nothing: this is a judgement, and the one number
 * a person might want to change. The reel stops, the lever and the payout all
 * play at their own volumes above it, and none of them is quieter than this.
 */
export const MUSIC_VOLUME = 0.34;

/** The track for each scene. Two, and nothing decides between them but phase. */
export const MUSIC_TRACKS: Record<MusicScene, string> = { pit: "musicPit", fight: "musicFight" };

const STORAGE_KEY = "servpit:music";

export interface MusicOptions {
  enabled?: boolean;
  storage?: Storage;
  volume?: number;
}

/** The scene a phase belongs to. Everything that is not a fight is the pit. */
export function sceneForPhase(phase: string | null | undefined): MusicScene {
  return phase === "fight" ? "fight" : "pit";
}

export class Music {
  private readonly tracks = new Set<string>();
  private on: boolean;
  private scene: MusicScene | null = null;
  private playing: string | null = null;

  constructor(
    defs: readonly AudioDef[],
    private readonly sink: AudioSink,
    private readonly options: MusicOptions = {},
  ) {
    for (const def of defs) if (def.loop) this.tracks.add(def.id);
    const stored = this.readStored();
    // Silent unless this browser has said otherwise, which is the same rule
    // the cues follow and the only one a browser will allow anyway.
    this.on = stored ?? options.enabled ?? false;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The track playing right now, for a test and for nothing else. */
  get current(): string | null {
    return this.playing;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.silence();
    else if (this.scene) this.play(this.scene);
    try {
      this.options.storage?.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // A blocked or full storage must never break the round.
    }
  }

  toggle(): void {
    this.setEnabled(!this.on);
  }

  /**
   * Follows the pit.
   *
   * A scene that has not changed does nothing at all, which is what stops a
   * bed restarting every time a phase mark lands.
   */
  setScene(scene: MusicScene): void {
    if (this.scene === scene) return;
    this.scene = scene;
    if (this.on) this.play(scene);
  }

  /** Stops the bed and forgets the scene, for a page leaving the pit. */
  stop(): void {
    this.scene = null;
    this.silence();
  }

  private play(scene: MusicScene): void {
    const id = MUSIC_TRACKS[scene];
    if (!this.tracks.has(id) || this.playing === id) return;
    this.silence();
    this.playing = id;
    this.sink.startLoop(id, { volume: this.options.volume ?? MUSIC_VOLUME });
  }

  private silence(): void {
    if (this.playing === null) return;
    this.sink.stopLoop(this.playing);
    this.playing = null;
  }

  private readStored(): boolean | null {
    try {
      const raw = this.options.storage?.getItem(STORAGE_KEY);
      if (raw === "on") return true;
      if (raw === "off") return false;
      return null;
    } catch {
      return null;
    }
  }
}
