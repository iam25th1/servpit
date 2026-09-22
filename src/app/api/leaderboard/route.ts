// GET /api/leaderboard: who has called the most rounds right.
//
// Read only, and points only. A row is a handle, a score and a count, and
// none of it is money or redeemable for any. Handles are unverified, so a row
// is a claim about a name rather than about a person; the README says so.

import { NextResponse, type NextRequest } from "next/server";
import { normaliseHandle } from "@/config/backing";
import { arenaReader } from "@/server/arena/read";
import { LeaderboardStore, leaderboardFile } from "@/server/backing/leaderboard";
import { readEnv } from "@/server/env";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A screenful. The board is paged rather than sent whole. */
export const PAGE_SIZE = 10;

let store: LeaderboardStore | undefined;

function board(network: string): LeaderboardStore {
  store ??= new LeaderboardStore(leaderboardFile(readEnv().dataDir, network), network);
  return store;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const network = arenaReader().chain.network;
    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const handle = normaliseHandle(request.nextUrl.searchParams.get("handle"));
    const held = board(network);
    return NextResponse.json({
      ...held.page(Number.isFinite(page) ? page : 1, PAGE_SIZE),
      // The viewer's own row, wherever it sits, so they need not page to it.
      you: handle ? held.row(handle) : null,
    });
  } catch (e) {
    const shown = publicError(e);
    log.error("leaderboard read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
