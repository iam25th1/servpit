// GET /api/health: is the pit alive, and what is it doing.
//
// For an uptime check and for somebody watching it through a week. It opens
// two files, the arena state and the worker's lock, and answers three things:
// whether the worker is there, how long since the last round, and whether the
// pit is running, resting or paused.
//
// Nothing else. No balances, no addresses, no pid, no paths, no configuration.
// A health endpoint is the most requested url on a deployment and the least
// watched line of code, so what it may say is decided in one pure function
// and tested there.

import { NextResponse } from "next/server";
import { roundIntervalSeconds } from "@/config/arena";
import { arenaReader } from "@/server/arena/read";
import { health } from "@/server/arena/health";
import { heartbeatAt } from "@/server/arena/lock";
import { readEnv } from "@/server/env";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const reader = arenaReader();
    const beat = heartbeatAt(readEnv().dataDir, reader.chain.network);
    const answer = health(reader.state(), beat, roundIntervalSeconds() * 1_000, reader.chain.network, Date.now());
    // A watcher that only reads the status code gets the same answer as one
    // that reads the body.
    return NextResponse.json(answer, { status: answer.ok ? 200 : 503 });
  } catch (e) {
    const shown = publicError(e);
    log.error("health read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ok: false, worker: "unknown", pit: "unknown", error: shown.message }, { status: 503 });
  }
}
