// GET /api/arena: what the pit is doing, and what it last did.
//
// Read only. It opens one file and returns a projection of it; it never
// plans, never settles and never touches a wallet. The projection is where
// the spoiler rule lives: see src/server/arena/view.ts.

import { NextResponse } from "next/server";
import { arenaReader } from "@/server/arena/read";
import { arenaView } from "@/server/arena/view";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const reader = arenaReader();
    return NextResponse.json(arenaView(reader.state(), reader.chain));
  } catch (e) {
    // Never the thrown error: a transport error quotes the endpoint url and a
    // keyed endpoint carries its credential in it.
    const shown = publicError(e);
    log.error("arena read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
