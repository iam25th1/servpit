// Fans ETH out from the funded wallet to the other six.
//
//   npm run fund-wallets                      tops each up to 0.002 ETH
//   npm run fund-wallets -- --target 0.005    a different target
//   npm run fund-wallets -- --dry-run         plan only, nothing sent
//
// Idempotent by construction: each wallet is topped up to the target, so a
// wallet already there is skipped and a rerun sends nothing. The check is the
// chain balance, not a local record, so it cannot drift from reality.

import { parseArgs } from "node:util";
import { parseEther } from "viem";
import { FUNDER_WALLET_ID } from "../src/config/wallets";
import { getServerContext } from "../src/server/context";
import { formatEth, basescanTx } from "../src/server/money";
import { planFunding, type FundingBalance } from "../src/server/wallets/funding";

const { values } = parseArgs({
  options: { target: { type: "string", default: "0.002" }, "dry-run": { type: "boolean", default: false } },
});

function parseTarget(raw: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new RangeError(`--target must be a decimal number of ETH, got ${raw}`);
  const wei = parseEther(raw as `${number}`);
  if (wei <= 0n) throw new RangeError("--target must be greater than zero");
  return wei;
}

async function main(): Promise<void> {
  const targetWei = parseTarget(values.target);
  const ctx = await getServerContext();

  if (!ctx.chain.settles) {
    console.error(`Wallet backend is ${ctx.chain.kind}, which needs no funding.`);
    console.error("Run npm run generate-wallets, fund the first address, then retry.");
    process.exitCode = 1;
    return;
  }

  console.log(`backend ${ctx.chain.kind} on ${ctx.chain.network}, target ${formatEth(targetWei)} ETH per wallet\n`);

  const wallets = [...ctx.wallets.agents.values(), ctx.wallets.pot];
  const balances: FundingBalance[] = [];
  for (const wallet of wallets) {
    balances.push({ id: wallet.id, address: wallet.address, balanceWei: await wallet.getBalance() });
  }

  console.log("balances before:");
  for (const b of balances) console.log(`  ${b.id.padEnd(6)} ${b.address}  ${formatEth(b.balanceWei).padStart(12)} ETH`);

  const plan = planFunding(FUNDER_WALLET_ID, balances, targetWei, ctx.chain.gasReserveWei);
  console.log(`\nfunder ${plan.funder.id} holds ${formatEth(plan.funder.balanceWei)} ETH`);
  for (const s of plan.skipped) console.log(`  skip ${s.id.padEnd(6)} already at ${formatEth(s.balanceWei)} ETH`);
  for (const t of plan.transfers) console.log(`  send ${formatEth(t.amountWei).padStart(12)} ETH to ${t.id.padEnd(6)} ${t.address}`);

  if (plan.transfers.length === 0) {
    console.log("\nNothing to do: every wallet is already at the target.");
    return;
  }
  console.log(`\ntotal to send ${formatEth(plan.totalWei)} ETH`);

  if (!plan.affordable) {
    console.error(`\nFunder is short by ${formatEth(plan.shortfallWei)} ETH, including ${formatEth(ctx.chain.gasReserveWei)} ETH held back for gas.`);
    console.error(`Top up ${plan.funder.address} from a faucet and retry.`);
    process.exitCode = 1;
    return;
  }

  if (values["dry-run"]) {
    console.log("\nDry run, nothing sent.");
    return;
  }

  const funderWallet = wallets.find((w) => w.id === FUNDER_WALLET_ID)!;
  console.log("");
  for (const transfer of plan.transfers) {
    const receipt = await funderWallet.send([{ to: transfer.address, value: transfer.amountWei }], `fund-${transfer.id}`);
    const link = ctx.chain.settles ? ` ${basescanTx(ctx.chain.network, receipt.txHash)}` : "";
    console.log(`  sent ${formatEth(transfer.amountWei).padStart(12)} ETH to ${transfer.id.padEnd(6)} ${receipt.txHash}${link}`);
  }

  console.log("\nbalances after:");
  for (const wallet of wallets) {
    console.log(`  ${wallet.id.padEnd(6)} ${wallet.address}  ${formatEth(await wallet.getBalance()).padStart(12)} ETH`);
  }
  console.log("\nRerunning this is safe: every wallet is at the target, so nothing would be sent.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
