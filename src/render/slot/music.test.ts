import { describe, expect, it, vi } from "vitest";
import type { AudioDef } from "../manifest";
import type { AudioSink } from "./audio";
import { MUSIC_VOLUME, Music, sceneForPhase } from "./music";

const DEFS: AudioDef[] = [
  { id: "musicPit", path: "/assets/audio/musicPit.ogg", loop: true },
  { id: "musicFight", path: "/assets/audio/musicFight.ogg", loop: true },
  { id: "reelSpin", path: "/assets/audio/reelSpin.wav", loop: true },
];

const sink = () => ({ play: vi.fn(), startLoop: vi.fn(), stopLoop: vi.fn() }) satisfies AudioSink;

const store = (value: string | null = null) => {
  const held = new Map<string, string>(value === null ? [] : [["servpit:music", value]]);
  return { getItem: (k: string) => held.get(k) ?? null, setItem: (k: string, v: string) => void held.set(k, v) } as unknown as Storage;
};

describe("the bed under the pit", () => {
  it("starts silent, like the rest of the audio", () => {
    const out = sink();
    const music = new Music(DEFS, out, { storage: store() });
    music.setScene("pit");
    expect(music.enabled).toBe(false);
    expect(out.startLoop).not.toHaveBeenCalled();
  });

  it("plays the pit's track once it is switched on", () => {
    const out = sink();
    const music = new Music(DEFS, out, { storage: store() });
    music.setScene("pit");
    music.setEnabled(true);
    expect(out.startLoop).toHaveBeenCalledWith("musicPit", { volume: MUSIC_VOLUME });
  });

  it("does not restart on a phase that does not change the scene", () => {
    // A round publishes a mark for every phase. Restarting the bed on each
    // of them would be a cut every few seconds.
    const out = sink();
    const music = new Music(DEFS, out, { storage: store("on") });
    for (const phase of ["planning", "deciding", "banking", "settling", "reels", "backing"]) music.setScene(sceneForPhase(phase));
    expect(out.startLoop).toHaveBeenCalledTimes(1);
    expect(out.stopLoop).not.toHaveBeenCalled();
    expect(music.current).toBe("musicPit");
  });

  it("changes track for the fight, and back again after it", () => {
    const out = sink();
    const music = new Music(DEFS, out, { storage: store("on") });
    music.setScene(sceneForPhase("deciding"));
    music.setScene(sceneForPhase("fight"));
    expect(out.stopLoop).toHaveBeenCalledWith("musicPit");
    expect(out.startLoop).toHaveBeenLastCalledWith("musicFight", { volume: MUSIC_VOLUME });
    music.setScene(sceneForPhase("result"));
    expect(out.startLoop).toHaveBeenLastCalledWith("musicPit", { volume: MUSIC_VOLUME });
  });

  it("stops when it is switched off, and picks the scene up again when it is back on", () => {
    const out = sink();
    const music = new Music(DEFS, out, { storage: store("on") });
    music.setScene("fight");
    music.toggle();
    expect(music.enabled).toBe(false);
    expect(out.stopLoop).toHaveBeenCalledWith("musicFight");
    music.toggle();
    expect(out.startLoop).toHaveBeenLastCalledWith("musicFight", { volume: MUSIC_VOLUME });
  });

  it("is remembered in this browser, separately from the cues", () => {
    const held = store();
    new Music(DEFS, sink(), { storage: held }).setEnabled(true);
    expect(held.getItem("servpit:music")).toBe("on");
    expect(held.getItem("servpit:audio")).toBeNull();
    expect(new Music(DEFS, sink(), { storage: held }).enabled).toBe(true);
  });

  it("sits under the cues", () => {
    // Every cue plays at its own volume and none of them is quieter than
    // this, which is what keeps a reel stop audible over the bed.
    expect(MUSIC_VOLUME).toBeLessThan(0.5);
  });

  it("survives a browser that refuses storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const music = new Music(DEFS, sink(), { storage: blocked });
    expect(music.enabled).toBe(false);
    expect(() => music.setEnabled(true)).not.toThrow();
    expect(music.enabled).toBe(true);
  });

  it("says nothing about a track the pack does not carry", () => {
    const out = sink();
    const music = new Music([], out, { storage: store("on") });
    music.setScene("pit");
    expect(out.startLoop).not.toHaveBeenCalled();
    expect(music.current).toBeNull();
  });
});
