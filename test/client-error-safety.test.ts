// Nothing internal reaches the browser.
//
// A viem transport error quotes the endpoint url, and a keyed endpoint
// carries its credential in that url, so an error passed through to the
// client publishes the operator's api key to every visitor who can make a
// round fail. This drives the real route handlers and reads what they
// actually write to the stream.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RPC_URLS } from "@/config/rpc";
import { DEFAULT_SERV } from "@/config/serv";
import { BankrollCache } from "@/server/bankroll";
import { TransferLedger } from "@/server/ledger";
import { PlanStore } from "@/server/round/planStore";
import { RolloverStore } from "@/server/round/rollover";
import { RoundStore } from "@/server/round/store";
import { CostMeter } from "@/server/serv/meter";
import { FakeChain } from "@/server/wallets/fake";
import { openWallets } from "@/server/wallets/open";
import { WalletRegistry } from "@/server/wallets/registry";

/** A real viem transport error, with a credential in the path. */
const KEYED_URL = "https://base-sepolia.example.com/v2/SUPERSECRETPROJECTKEY";
const VIEM_ERROR = [
  "The request took too long to respond.",
  "",
  `URL: ${KEYED_URL}`,
  'Request body: {"method":"eth_getBalance","params":["0x1aC16dC29f2ACf1A628BA28fAce094d152F1197e","latest"]}',
  "",
  "Details: The request timed out.",
  "Version: viem@2.38.3",
].join("\n");

const viemError = (): Error => {
  const e = new Error(VIEM_ERROR);
  e.name = "TimeoutError";
  e.stack = `TimeoutError: ${VIEM_ERROR}\n    at Object.request (/Users/x/servpit/node_modules/viem/utils/rpc/http.ts:131:28)`;
  return e;
};

let dir: string;
let ctx: Record<string, unknown>;

async function buildContext(options: { deadChain?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), "servpit-errsafety-"));
  const chain = new FakeChain({ initialBalanceWei: 100_000_000_000_000n });
  const registry = new WalletRegistry(join(dir, "wallets.json"));
  const wallets = await openWallets(chain, registry);
  const live = options.deadChain ? ({ ...chain, getBalances: async () => { throw viemError(); } } as unknown as FakeChain) : chain;
  if (options.deadChain) {
    for (const [id, wallet] of wallets.agents) {
      wallets.agents.set(id, { ...wallet, getBalance: async () => { throw viemError(); } });
    }
  }
  const flow = {
    chain: live,
    wallets,
    ledger: new TransferLedger(join(dir, "ledger.json")),
    store: new RoundStore(join(dir, "rounds.json")),
    bankroll: new BankrollCache({ ttlMs: 5_000, now: () => Date.now() }),
    meter: new CostMeter(DEFAULT_SERV.pricing),
    plans: new PlanStore(join(dir, "plans.json")),
    rollover: new RolloverStore(join(dir, "rollover.json")),
    entrants: 24,
  };
  return { env: {}, chain: live, registry, wallets, bankroll: flow.bankroll, flow };
}

vi.mock("@/server/context", () => ({ getServerContext: async () => ctx }));
vi.mock("@/server/settleContext", () => ({ getSettleContext: async () => ctx }));

const post = async (handler: (r: Request) => Promise<Response>, body: unknown): Promise<string> => {
  const response = await handler(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return await response.text();
};

/** Everything that must never appear in something a browser receives. */
function leaks(payload: string): string[] {
  const found: string[] = [];
  if (payload.includes("SUPERSECRETPROJECTKEY")) found.push("the credential from a keyed rpc url");
  if (payload.includes("base-sepolia.example.com")) found.push("an rpc host");
  for (const url of DEFAULT_RPC_URLS) if (payload.includes(new URL(url).host)) found.push(`the rpc host ${new URL(url).host}`);
  if (payload.includes("viem@")) found.push("a viem version banner");
  if (/Request body:/.test(payload)) found.push("a quoted rpc request body");
  if (/Details: The request/.test(payload)) found.push("transport error detail");
  if (/\\n\s+at /.test(payload) || /\n\s+at /.test(payload)) found.push("a stack frame");
  if (payload.includes("node_modules")) found.push("a path inside node_modules");
  for (const match of payload.match(/https?:\/\/[^\s"'\\]+/g) ?? []) {
    if (!/^https:\/\/[a-z-]*\.?basescan\.org\//.test(match)) found.push(`an unexpected url: ${match}`);
  }
  return found;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("the plan route", () => {
  it("answers a chain failure with a plain sentence and a code, and nothing else", async () => {
    ctx = await buildContext({ deadChain: true });
    const { POST } = await import("@/app/api/round/plan/route");
    const body = await post(POST, { seed: "leaky", entrants: 24 });

    expect(leaks(body)).toEqual([]);
    const line = JSON.parse(body.trim().split("\n").pop()!);
    expect(line.type).toBe("error");
    expect(line.code).toBe("chain_unreachable");
    expect(line.message).toBe("Can't reach the network right now. Try again in a moment.");
    expect(line.retryable).toBe(true);
  });

  it("leaks nothing on the way through a round that works either", async () => {
    ctx = await buildContext();
    const { POST } = await import("@/app/api/round/plan/route");
    const body = await post(POST, { seed: "clean", entrants: 24 });
    expect(leaks(body)).toEqual([]);
    expect(body).toContain('"type":"plan"');
  });

  it("refuses a bad request without echoing what was sent", async () => {
    ctx = await buildContext();
    const { POST } = await import("@/app/api/round/plan/route");
    const body = await post(POST, { seed: "../../etc/passwd", entrants: 24 });
    expect(leaks(body)).toEqual([]);
    expect(body).not.toContain("etc/passwd");
  });
});

describe("the run route", () => {
  it("answers an unquoted round with a plain sentence", async () => {
    ctx = await buildContext();
    const { POST } = await import("@/app/api/round/run/route");
    const body = await post(POST, { seed: "neverquoted", entrants: 24 });

    expect(leaks(body)).toEqual([]);
    const line = JSON.parse(body.trim().split("\n").pop()!);
    expect(line.type).toBe("error");
    expect(line.code).toBe("round_expired");
    expect(line.message).toBe("That round is no longer on the table. Start a new one.");
  });

  it("answers a transport failure with the generic sentence, never the transport's words", async () => {
    ctx = await buildContext();
    const plans = (ctx.flow as { plans: PlanStore }).plans;
    vi.spyOn(plans, "require").mockImplementation(() => { throw viemError(); });
    const { POST } = await import("@/app/api/round/run/route");
    const body = await post(POST, { seed: "boom", entrants: 24 });

    expect(leaks(body)).toEqual([]);
    const line = JSON.parse(body.trim().split("\n").pop()!);
    expect(line.code).toBe("internal");
    expect(line.message).toBe("Something went wrong on our side. Try again in a moment.");
  });
});
