import { describe, expect, it, vi } from "vitest";
import type { AudioDef } from "../manifest";
import { SlotAudio, type AudioSink } from "./audio";

const DEFS: AudioDef[] = [
  { id: "leverPull", path: "/assets/audio/leverPull.wav", loop: false },
  { id: "reelSpin", path: "/assets/audio/reelSpin.wav", loop: true },
  { id: "reelStop", path: "/assets/audio/reelStop.wav", loop: false },
  { id: "payoutTransient", path: "/assets/audio/payoutTransient.wav", loop: false },
  { id: "payoutBody", path: "/assets/audio/payoutBody.wav", loop: false },
  { id: "winSting", path: "/assets/audio/winSting.wav", loop: false },
];

interface Played {
  id: string;
  rate: number;
  volume: number;
}

function fakeSink() {
  const played: Played[] = [];
  const loops: string[] = [];
  const stopped: string[] = [];
  const sink: AudioSink = {
    play: (id, options) => played.push({ id, rate: options?.rate ?? 1, volume: options?.volume ?? 1 }),
    startLoop: (id) => loops.push(id),
    stopLoop: (id) => stopped.push(id),
  };
  return { sink, played, loops, stopped };
}

const store = { getItem: vi.fn(), setItem: vi.fn() };
const makeAudio = (muted = true) => {
  const { sink, played, loops, stopped } = fakeSink();
  const audio = new SlotAudio(DEFS, sink, { muted, storage: store as unknown as Storage });
  return { audio, played, loops, stopped };
};

describe("SlotAudio muting", () => {
  it("starts muted, because a browser blocks audio before a gesture", () => {
    const { audio, played } = makeAudio();
    expect(audio.muted).toBe(true);
    audio.play("reelStop");
    expect(played).toHaveLength(0);
  });

  it("unmutes on the first user gesture and plays from then on", () => {
    const { audio, played } = makeAudio();
    audio.unlock();
    expect(audio.muted).toBe(false);
    audio.play("reelStop");
    expect(played.map((p) => p.id)).toEqual(["reelStop"]);
  });

  it("only unlocks once, so a later gesture cannot override a deliberate mute", () => {
    const { audio, played } = makeAudio();
    audio.unlock();
    audio.setMuted(true);
    audio.unlock();
    expect(audio.muted).toBe(true);
    audio.play("reelStop");
    expect(played).toHaveLength(0);
  });

  it("persists the mute choice and reads it back", () => {
    const setItem = vi.fn();
    const storage = { getItem: vi.fn().mockReturnValue("muted"), setItem } as unknown as Storage;
    const { sink } = fakeSink();
    const audio = new SlotAudio(DEFS, sink, { storage });
    expect(audio.muted).toBe(true);
    audio.setMuted(false);
    expect(setItem).toHaveBeenCalledWith("servpit:audio", "on");
    const restored = new SlotAudio(DEFS, sink, { storage: { getItem: () => "on", setItem } as unknown as Storage });
    expect(restored.muted).toBe(false);
  });

  it("stops any loop when muted mid spin", () => {
    const { audio, stopped } = makeAudio(false);
    audio.startLoop("reelSpin");
    audio.setMuted(true);
    expect(stopped).toContain("reelSpin");
  });

  it("ignores an unknown id rather than throwing mid round", () => {
    const { audio, played } = makeAudio(false);
    expect(() => audio.play("noSuchSound")).not.toThrow();
    expect(played).toHaveLength(0);
  });
});

describe("SlotAudio slot cues", () => {
  it("gives each reel stop a distinct pitch so three stops do not sound identical", () => {
    const { audio, played } = makeAudio(false);
    audio.reelStop(0);
    audio.reelStop(1);
    audio.reelStop(2);
    expect(played.map((p) => p.id)).toEqual(["reelStop", "reelStop", "reelStop"]);
    const rates = played.map((p) => p.rate);
    expect(new Set(rates).size).toBe(3);
    expect(rates[1]).toBeGreaterThan(rates[0]);
    expect(rates[2]).toBeGreaterThan(rates[1]);
  });

  it("layers the payout: a sharp transient over a low body, one alone reads thin", () => {
    const { audio, played } = makeAudio(false);
    audio.payout();
    expect(played.map((p) => p.id)).toEqual(["payoutTransient", "payoutBody"]);
    const body = played.find((p) => p.id === "payoutBody")!;
    const transient = played.find((p) => p.id === "payoutTransient")!;
    expect(body.rate).toBeLessThan(transient.rate);
    expect(body.volume).toBeGreaterThan(0);
  });

  it("runs the spin as a loop and stops it when the reels settle", () => {
    const { audio, loops, stopped } = makeAudio(false);
    audio.startSpin();
    expect(loops).toEqual(["reelSpin"]);
    audio.stopSpin();
    expect(stopped).toEqual(["reelSpin"]);
  });

  it("never starts a loop for a sample the manifest marks as a one shot", () => {
    const { audio, loops } = makeAudio(false);
    audio.startLoop("reelStop");
    expect(loops).toHaveLength(0);
  });
});
