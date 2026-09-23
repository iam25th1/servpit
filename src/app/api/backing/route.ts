// GET /api/backing: who has backed whom in the round being played.
// POST /api/backing: back one of them, while the window is open.
//
// Points only. Nothing here moves a chip, and nothing here can: the only
// writes are lines in a log, and the only reads are that log and the arena
// file. What may be picked, and until when, is decided from the arena store
// rather than from the request, so a client that sends its own round id, its
// own phase or its own closing time changes nothing.

import { NextResponse, type NextRequest } from "next/server";
import { arenaMode } from "@/config/arena";
import { PICKS_PER_MINUTE_PER_PLACE } from "@/config/backing";
import { arenaReader } from "@/server/arena/read";
import { pickReader } from "@/server/backing/read";
import { RateLimiter } from "@/server/backing/limit";
import { backingView, pickLimiter, submitPick } from "@/server/backing/service";
import { TOO_LARGE, readBody } from "@/server/net/body";
import { visitorKey } from "@/server/net/visitor";
import { fighterReader } from "@/server/fighters/read";
import { ownerAcross } from "@/server/identity/service";
import { pullReader } from "@/server/pulls/read";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Longer than a pick and far shorter than an attack. */
const MAX_BODY_BYTES = 2_000;

/** Picks from one place, for the limit a browser's own token cannot carry. */
const placeLimiter = new RateLimiter(PICKS_PER_MINUTE_PER_PLACE);

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const handle = request.nextUrl.searchParams.get("handle");
    return NextResponse.json(backingView(arenaReader().state(), pickReader(), handle));
  } catch (e) {
    const shown = publicError(e);
    log.error("backing read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Read with a ceiling rather than read and then measure: the measuring
    // version held every byte an attacker chose to send before refusing it.
    const body = await readBody(request, MAX_BODY_BYTES);
    if (!body.ok) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
    let input: unknown;
    try {
      input = JSON.parse(body.text);
    } catch {
      return NextResponse.json({ error: "That is not a pick." }, { status: 400 });
    }
    const { handle, token, agentId } = (input ?? {}) as { handle?: unknown; token?: unknown; agentId?: unknown };

    const answer = submitPick(
      arenaReader().state(),
      { handle, token, agentId },
      {
        store: pickReader(),
        limiter: pickLimiter,
        crowd: () => placeLimiter.allow(visitorKey(request.headers)),
        arenaMode: arenaMode(),
        otherOwner: ownerAcross([pullReader(), fighterReader()]),
      },
    );
    if (!answer.ok) return NextResponse.json({ error: answer.message }, { status: answer.status });
    return NextResponse.json(answer.view);
  } catch (e) {
    // Never the thrown error. A store error quotes a path, and a path is the
    // operator's filesystem rather than anything a viewer should read.
    const shown = publicError(e);
    log.error("pick failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
