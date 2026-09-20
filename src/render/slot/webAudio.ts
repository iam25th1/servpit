// Real audio sink. Decodes each sample once through the Web Audio API so a
// cue can be fired many times without reloading, and so playback rate can
// shift pitch per reel stop. Nothing here schedules time.

import type { AudioDef } from "../manifest";
import type { AudioSink, PlayOptions } from "./audio";

export async function createWebAudioSink(defs: readonly AudioDef[]): Promise<AudioSink & { close(): void }> {
  const context = new AudioContext();
  const buffers = new Map<string, AudioBuffer>();
  const loops = new Map<string, AudioBufferSourceNode>();

  await Promise.all(
    defs.map(async (def) => {
      const response = await fetch(def.path);
      if (!response.ok) throw new Error(`audio ${def.id}: HTTP ${response.status}`);
      buffers.set(def.id, await context.decodeAudioData(await response.arrayBuffer()));
    }),
  );

  const source = (id: string, options: PlayOptions | undefined, loop: boolean): AudioBufferSourceNode | null => {
    const buffer = buffers.get(id);
    if (!buffer) return null;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = loop;
    node.playbackRate.value = options?.rate ?? 1;
    const gain = context.createGain();
    gain.gain.value = options?.volume ?? 1;
    node.connect(gain).connect(context.destination);
    return node;
  };

  return {
    play(id, options) {
      if (context.state === "suspended") void context.resume();
      source(id, options, false)?.start();
    },
    startLoop(id, options) {
      if (loops.has(id)) return;
      if (context.state === "suspended") void context.resume();
      const node = source(id, options, true);
      if (!node) return;
      loops.set(id, node);
      node.start();
    },
    stopLoop(id) {
      const node = loops.get(id);
      if (!node) return;
      loops.delete(id);
      node.stop();
    },
    close() {
      for (const node of loops.values()) node.stop();
      loops.clear();
      void context.close();
    },
  };
}
