// GET /api/fighters: the fighters board.
//
// Read only, and separate from the backing board on purpose: backing scores
// a call, and a fighter's record is mostly luck, one seat in twenty four.
// Mixing them would make luck look like skill.
//
// A row is a name, a face and counts. Handles are unverified, so a row is a
// claim about a name rather than about a person, which the README says.

import { NextResponse, type NextRequest } from "next/server";
import { normaliseHandle } from "@/config/backing";
import { arenaReader } from "@/server/arena/read";
import { readEnv } from "@/server/env";
import { CareerStore, careerFile } from "@/server/fighters/careerStore";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A screenful. The board is paged rather than sent whole. */
export const PAGE_SIZE = 10;

let store: CareerStore | undefined;

function careers(network: string): CareerStore {
  store ??= new CareerStore(careerFile(readEnv().dataDir, network), network);
  return store;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const network = arenaReader().chain.network;
    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const handle = normaliseHandle(request.nextUrl.searchParams.get("handle"));
    const held = careers(network);
    return NextResponse.json({
      ...held.page(Number.isFinite(page) ? page : 1, PAGE_SIZE),
      // The viewer's own row, wherever it sits, so they need not page to it.
      you: handle ? held.row(handle) : null,
    });
  } catch (e) {
    const shown = publicError(e);
    log.error("fighters board read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
