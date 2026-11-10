// GET /api/status: whether the pit is playing, and if not, what it needs.
//
// Everything /api/health says, and the balances the worker found the last
// time it looked: the pot, the bank and the operator, in chips and in ETH,
// what a round needs each to hold, and what has to be sent to each before the
// pit plays again. Read from the arena state the worker writes, so a request
// here never reaches the chain.
//
// Balances and nothing that locates them: no address, no key, no hash, no
// path. Answers 200 whenever it can read the state, paused or not, because a
// pit waiting for money is a pit doing what it should.

import { NextResponse } from "next/server";
import { roundIntervalSeconds } from "@/config/arena";
import { arenaReader } from "@/server/arena/read";
import { pitStatus } from "@/server/arena/health";
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
    return NextResponse.json(pitStatus(reader.state(), beat, roundIntervalSeconds() * 1_000, reader.chain.network, Date.now()));
  } catch (e) {
    const shown = publicError(e);
    log.error("status read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ok: false, worker: "unknown", pit: "unknown", error: shown.message }, { status: 503 });
  }
}
