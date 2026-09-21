// GET /api/graveyard: every agent that has been retired, for the wall.
//
// Read only, and deliberately narrow. The wreck store holds the seat's wallet
// id, which names a seat rather than an address, and no address, key or hash
// is on this route at all: a public wall of the dead does not need to say
// where anybody's money was. Chips, not wei, because nothing downstream does
// arithmetic on these numbers.
//
// With the bank off there are no wrecks to show and the client renders no way
// in, so this answers with the flag rather than a list. Node runtime: the
// store reads a file.

import { NextResponse } from "next/server";
import { bankEnabled } from "@/config/economy";
import { faceFor } from "@/config/replacements";
import { toChips } from "@/config/stake";
import { getServerContext } from "@/server/context";
import { overReached } from "@/server/round/wrecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  if (!bankEnabled()) return NextResponse.json({ enabled: false, graves: [] });
  const ctx = await getServerContext();
  const graves = ctx.flow.wreckStore.all().map((w) => ({
    walletId: w.walletId,
    identityId: w.identityId,
    name: w.name,
    // The face the panel drew for it while it was alive. Null means one of
    // the six who started, which the client draws from its own roster.
    face: faceFor(w.walletId, w.identityId),
    // The whole record decides this, not the trigger alone: most agents that
    // over-reach are recorded as broke and denied, because they lose the
    // balance before the debt passes the ceiling.
    cause: overReached(w) ? "over-reached" : "ran out of credit",
    roundsSurvived: w.roundsSurvived,
    wins: w.wins,
    peakBalance: toChips(BigInt(w.peakBalanceWei)),
    debtAtDeath: toChips(BigInt(w.debtAtDeathWei)),
    at: w.at,
  }));
  return NextResponse.json({ enabled: true, graves });
}
