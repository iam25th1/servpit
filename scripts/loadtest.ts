// How many spectators a deployment holds, measured rather than guessed.
//
//   npm run loadtest -- https://servpit.25th.dev
//   npm run loadtest -- http://localhost:3000 --levels 25,100,400 --hold 30
//   npm run loadtest -- https://servpit.25th.dev --pid 83787
//
// A spectator here is what a spectator is: one held phase stream, and a page
// load now and then. Every request it makes is a GET. It never posts, never
// pulls the lever, never claims a seat and never starts a round, which is
// what makes it safe to point at a live pit.
//
// With --pid it also samples what that process is doing while the load is on,
// which is how the numbers in the README were taken. Run from the same
// machine as the server, the generator competes with it for the cpu, so every
// number it reports is worse than the server on its own would give.

import { execFileSync } from "node:child_process";

interface Options {
  base: string;
  levels: number[];
  holdMs: number;
  pid: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function options(argv: readonly string[]): Options {
  const base = argv[0];
  if (base === undefined || !/^https?:\/\//.test(base)) {
    throw new RangeError("give the url to measure, for example https://servpit.25th.dev");
  }
  const flag = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const levels = (flag("levels") ?? "25,100,400,1000,2000,3000").split(",").map(Number);
  if (levels.some((n) => !Number.isInteger(n) || n < 1)) throw new RangeError("--levels takes whole numbers of spectators");
  const hold = Number(flag("hold") ?? 30);
  if (!Number.isInteger(hold) || hold < 1) throw new RangeError("--hold takes whole seconds");
  return { base: base.replace(/\/$/, ""), levels, holdMs: hold * 1_000, pid: flag("pid") ?? null };
}

/** What a process is doing right now, or nothing when it is not there. */
function sample(pid: string): { cpu: number; rssMb: number } {
  try {
    const [cpu, rss] = execFileSync("ps", ["-o", "%cpu=,rss=", "-p", pid]).toString().trim().split(/\s+/);
    return { cpu: Number(cpu), rssMb: Number(rss) / 1024 };
  } catch {
    return { cpu: 0, rssMb: 0 };
  }
}

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

async function main(): Promise<void> {
  const { base, levels, holdMs, pid } = options(process.argv.slice(2));
  const watchers: AbortController[] = [];
  let open = 0;
  let failed = 0;
  let dropped = 0;
  const why = new Map<string, number>();

  const watch = (): void => {
    const controller = new AbortController();
    watchers.push(controller);
    void fetch(`${base}/api/arena/stream`, { signal: controller.signal, headers: { accept: "text/event-stream" } })
      .then(async (response) => {
        if (!response.ok || response.body === null) {
          failed += 1;
          why.set(`HTTP ${response.status}`, (why.get(`HTTP ${response.status}`) ?? 0) + 1);
          return;
        }
        open += 1;
        const reader = response.body.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (done) {
            open -= 1;
            dropped += 1;
            return;
          }
        }
      })
      .catch((e: Error & { cause?: { code?: string } }) => {
        if (controller.signal.aborted) return;
        failed += 1;
        const reason = e.cause?.code ?? e.message;
        why.set(reason, (why.get(reason) ?? 0) + 1);
      });
  };

  const page = async (times: number[], errors: string[]): Promise<void> => {
    const started = performance.now();
    try {
      const response = await fetch(`${base}/`, { headers: { "cache-control": "no-cache" } });
      await response.arrayBuffer();
      if (!response.ok) errors.push(`HTTP ${response.status}`);
      times.push(performance.now() - started);
    } catch (e) {
      errors.push((e as Error).message);
    }
  };

  console.log(`${base}: ${levels.join(", ")} spectators, ${holdMs / 1_000}s at each`);
  for (const level of levels) {
    while (watchers.length < level) watch();
    await sleep(3_000);

    const times: number[] = [];
    const errors: string[] = [];
    const cpu: number[] = [];
    const rss: number[] = [];
    const until = Date.now() + holdMs;
    // One page load per spectator every fifteen seconds, which is somebody
    // opening the pit and then watching it.
    const loading = (async () => {
      while (Date.now() < until) {
        await Promise.all(Array.from({ length: Math.max(1, Math.round(level / 15)) }, () => page(times, errors)));
        await sleep(1_000);
      }
    })();
    const sampling = (async () => {
      while (Date.now() < until) {
        if (pid !== null) {
          const now = sample(pid);
          cpu.push(now.cpu);
          rss.push(now.rssMb);
        }
        await sleep(1_000);
      }
    })();
    await Promise.all([loading, sampling]);

    const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
    console.log(
      [
        `${String(level).padStart(5)} spectators`,
        `streams ${open} open, ${failed} refused, ${dropped} dropped`,
        `page p50 ${percentile(times, 50).toFixed(0)}ms, p95 ${percentile(times, 95).toFixed(0)}ms, n ${times.length}`,
        `page errors ${errors.length}`,
        pid === null ? "" : `origin cpu ${Math.max(...cpu, 0).toFixed(0)}% peak, ${mean(cpu).toFixed(0)}% mean, rss ${Math.max(...rss, 0).toFixed(0)} MB`,
        why.size === 0 ? "" : `refused because ${[...why].map(([k, v]) => `${k} x${v}`).join(", ")}`,
      ]
        .filter((part) => part.length > 0)
        .join(" | "),
    );
  }

  for (const controller of watchers) controller.abort();
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
