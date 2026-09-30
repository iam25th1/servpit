// GET /api/calls: this visitor's calls on the next round, and on the round on
// file. Only to the browser that owns the handle, so nobody can copy a read.
// POST /api/calls: call the agents in or out, while no round is being decided.
//
// Points only. Nothing here moves a chip or reaches an agent, and nothing
// can: the only write is a line in the pick log, and the agents never read
// it. When calls are taken, and which round they are filed after, is decided
// from the arena store rather than from the request, so a client that sends
// its own round id or its own idea of the phase changes nothing.

import { NextResponse, type NextRequest } from "next/server";
import { arenaMode } from "@/config/arena";
import { arenaReader } from "@/server/arena/read";
import { pickReader } from "@/server/backing/read";
import { callLimiter, callsView, submitCalls } from "@/server/calls/service";
import { fighterReader } from "@/server/fighters/read";
import { ownerAcross } from "@/server/identity/service";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";
import { pullReader } from "@/server/pulls/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Six seats, a handle and a token. Anything larger is not a set of calls. */
const MAX_BODY_BYTES = 2_000;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const handle = request.nextUrl.searchParams.get("handle");
    const token = request.nextUrl.searchParams.get("token");
    return NextResponse.json(callsView(arenaReader().state(), pickReader(), handle, token));
  } catch (e) {
    const shown = publicError(e);
    log.error("calls read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Those are not calls." }, { status: 413 });
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Those are not calls." }, { status: 400 });
    }
    const { handle, token, calls } = (input ?? {}) as { handle?: unknown; token?: unknown; calls?: unknown };

    const answer = submitCalls(
      arenaReader().state(),
      { handle, token, calls },
      { store: pickReader(), limiter: callLimiter, arenaMode: arenaMode(), otherOwner: ownerAcross([pullReader(), fighterReader()]) },
    );
    if (!answer.ok) return NextResponse.json({ error: answer.message }, { status: answer.status });
    return NextResponse.json(answer.view);
  } catch (e) {
    // Never the thrown error. A store error quotes a path, and a path is the
    // operator's filesystem rather than anything a viewer should read.
    const shown = publicError(e);
    log.error("calls failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
