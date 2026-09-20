// GET /api/agents: the six named agents and the pot, with addresses and
// live chain balances. Node runtime: AgentKit and the CDP SDK need it.

import { NextResponse } from "next/server";
import { NAMED_AGENTS } from "@/config/agents";
import { getServerContext } from "@/server/context";
import { basescanAddress } from "@/server/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const ctx = await getServerContext();
  ctx.bankroll.invalidate();
  const link = (address: string) => (ctx.chain.settles ? basescanAddress(ctx.chain.network, address) : null);
  const agents = await Promise.all(
    NAMED_AGENTS.map(async (profile) => {
      const wallet = ctx.wallets.agents.get(profile.id)!;
      return { ...profile, address: wallet.address, balanceWei: (await ctx.bankroll.get(wallet)).toString(), link: link(wallet.address) };
    }),
  );
  const pot = { address: ctx.wallets.pot.address, balanceWei: (await ctx.bankroll.get(ctx.wallets.pot)).toString(), link: link(ctx.wallets.pot.address) };
  return NextResponse.json({ backend: ctx.chain.kind, network: ctx.chain.network, agents, pot });
}
