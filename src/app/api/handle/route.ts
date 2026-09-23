// GET /api/handle: is this name free, mine, or somebody else's.
//
// Read only. It binds nothing: the claim still happens on the first pick or
// the first pull, under the append lock, exactly as before. This is what lets
// the interface answer a visitor while the field is still in front of them,
// with names they can actually take.
//
// Nothing about a round is reachable from here.

import { NextResponse, type NextRequest } from "next/server";
import { pickReader } from "@/server/backing/read";
import { lookUpHandle } from "@/server/identity/service";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";
import { pullReader } from "@/server/pulls/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const handle = request.nextUrl.searchParams.get("handle");
    const token = request.nextUrl.searchParams.get("token");
    // Both logs, because a handle claimed by pulling the lever is claimed.
    return NextResponse.json(lookUpHandle({ handle, token }, { logs: [pickReader(), pullReader()] }));
  } catch (e) {
    const shown = publicError(e);
    log.error("handle lookup failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
