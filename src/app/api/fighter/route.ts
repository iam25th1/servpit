// GET /api/fighter: this browser's fighter, and the faces still free.
// POST /api/fighter: claim a seat in the pit.
//
// The only write is a line in a log. Nothing here plans a round, moves a chip
// or touches a wallet: a claimed seat is a house seat with a name on it, and
// the settle path pays only the six agents, so a fighter costs nothing and
// pays nothing.
//
// Nothing about a round is reachable from here.

import { NextResponse, type NextRequest } from "next/server";
import { arenaMode } from "@/config/arena";
import { CLAIMS_PER_MINUTE, fighterSettingsFile } from "@/config/fighters";
import { readFighterSettings } from "@/server/fighters/settings";
import { pickReader } from "@/server/backing/read";
import { RateLimiter } from "@/server/backing/limit";
import { arenaReader } from "@/server/arena/read";
import { readEnv } from "@/server/env";
import { CareerStore, careerFile } from "@/server/fighters/careerStore";
import { claimFighter, fighterStatus } from "@/server/fighters/service";
import { fighterReader } from "@/server/fighters/read";
import { log } from "@/server/log";
import { internalDetail, publicError } from "@/server/publicError";
import { pullReader } from "@/server/pulls/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A handle, a token, a name and a face. Anything larger is not a claim. */
const MAX_BODY_BYTES = 2_000;

/** The limiter for this process, since a limit per request would limit nothing. */
const claimLimiter = new RateLimiter(CLAIMS_PER_MINUTE);

let careers: CareerStore | undefined;

function careerStore(): CareerStore {
  const network = arenaReader().chain.network;
  careers ??= new CareerStore(careerFile(readEnv().dataDir, network), network);
  return careers;
}

function deps() {
  // Read per request, like the pull limits: an operator changing the cap
  // while visitors are claiming should be heard on the next claim.
  const settings = readFighterSettings(fighterSettingsFile(readEnv().dataDir));
  return {
    store: fighterReader(),
    limiter: claimLimiter,
    arenaMode: arenaMode(),
    logs: [pickReader(), pullReader()],
    career: (handle: string) => careerStore().row(handle),
    cap: settings.cap,
    reserve: settings.reserve,
    releaseMs: settings.releaseHours * 60 * 60_000,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const handle = request.nextUrl.searchParams.get("handle");
    const token = request.nextUrl.searchParams.get("token");
    return NextResponse.json(fighterStatus({ handle, token }, deps()));
  } catch (e) {
    const shown = publicError(e);
    log.error("fighter read failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: "That is not a claim." }, { status: 413 });
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "That is not a claim." }, { status: 400 });
    }
    const { handle, token, name, face } = (input ?? {}) as { handle?: unknown; token?: unknown; name?: unknown; face?: unknown };

    const answer = claimFighter({ handle, token, name, face }, deps());
    if (!answer.ok) return NextResponse.json({ error: answer.message }, { status: answer.status });
    return NextResponse.json(answer.view);
  } catch (e) {
    // Never the thrown error. A store error quotes a path, and a path is the
    // operator's filesystem rather than anything a viewer should read.
    const shown = publicError(e);
    log.error("claim failed", { code: shown.code, detail: internalDetail(e) });
    return NextResponse.json({ ...shown, error: shown.message }, { status: 500 });
  }
}
