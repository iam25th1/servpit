// POST /api/pull: ask the pit for a round.
//
// The only write is a line in a log. Nothing here plans a round, moves a
// chip or touches a wallet: the worker is still the only writer of rounds,
// and it decides what to do with the ask on its own clock.
//
// What comes back is whether the ask landed and one sentence about it. No
// round id, no seed, no plan, no draw, no placements, no winner. The
// resolver is deterministic, so any of those before the fight is the fight
// given away, which is why the round routes are closed in arena mode at all.

import { NextResponse, type NextRequest } from "next/server";
import { arenaMode } from "@/config/arena";
import { arenaReader } from "@/server/arena/read";
import { pickReader } from "@/server/backing/read";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";
import { pullReader } from "@/server/pulls/read";
import { requestPull } from "@/server/pulls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A handle and a token. Anything larger is not an ask. */
const MAX_BODY_BYTES = 2_000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: "That is not a pull." }, { status: 413 });
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "That is not a pull." }, { status: 400 });
    }
    const { handle, token } = (input ?? {}) as { handle?: unknown; token?: unknown };

    const answer = requestPull(
      arenaReader().state(),
      { handle, token },
      { store: pullReader(), arenaMode: arenaMode(), backingOwner: (name) => pickReader().owner(name) },
    );
    if (!answer.ok) return NextResponse.json({ error: answer.message }, { status: answer.status });
    return NextResponse.json(answer.view);
  } catch (e) {
    // Never the thrown error. A store error quotes a path, and a path is the
    // operator's filesystem rather than anything a viewer should read.
    const shown = publicError(e);
    log.error("pull failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
