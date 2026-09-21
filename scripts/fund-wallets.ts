// Fans ETH out from the funded wallet to the other six.
//
//   npm run fund-wallets                      tops each up to the target
//   npm run fund-wallets -- --target 0.005    a different target
//   npm run fund-wallets -- --dry-run         plan only, nothing sent
//
// The bank is included when a key for it exists, at its own target: it holds
// a treasury to lend from rather than a playing balance, so topping it up to
// what an agent needs would be the wrong number in both directions.
//
// The target defaults to SERVPIT_FUND_TARGET_ETH, or 0.0001 ETH. It was a
// hardcoded 0.002, which needs 0.012 ETH to fan out to six wallets. A Base
// Sepolia faucet gives 0.001, so the run could never afford itself.
//
// Idempotent by construction: each wallet is topped up to the target, so a
// wallet already there is skipped and a rerun sends nothing. The check is the
// chain balance, not a local record, so it cannot drift from reality.

import { parseArgs } from "node:util";
import { parseEther } from "viem";
import { loadLocalEnv } from "./lib/loadEnv";
import { requireDeclaredBackend } from "./lib/requireBackend";
import { BANK_WALLET_ID, FUNDER_WALLET_ID } from "../src/config/wallets";
import { getServerContext } from "../src/server/context";
import { readEnv } from "../src/server/env";
import { formatEth, basescanTx } from "../src/server/money";
import { planFunding, type FundingBalance, type TargetsById } from "../src/server/wallets/funding";
import { stakeWeiFrom } from "../src/config/stake";

// Before anything reads the environment, including the module that registers
// the keys with the logger.
const envFile = loadLocalEnv();

/** 0.0001 ETH per wallet: six of them plus a gas reserve fit inside 0.001. */
const DEFAULT_TARGET_ETH = "0.0001";

/**
 * 0.0005 ETH for the bank, five funded wallets' worth.
 *
 * The simulator opens the bank on 500 chips, which at 100 chips to a funded
 * wallet is exactly this. It is a treasury to lend from, not a seat.
 */
const DEFAULT_BANK_TARGET_ETH = "0.0005";

const { values } = parseArgs({
  options: {
    target: { type: "string", default: process.env.SERVPIT_FUND_TARGET_ETH?.trim() || DEFAULT_TARGET_ETH },
    "bank-target": { type: "string", default: process.env.SERVPIT_BANK_TARGET_ETH?.trim() || DEFAULT_BANK_TARGET_ETH },
    "dry-run": { type: "boolean", default: false },
  },
});

function parseTarget(raw: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new RangeError(`--target must be a decimal number of ETH, got ${raw}`);
  const wei = parseEther(raw as `${number}`);
  if (wei <= 0n) throw new RangeError("--target must be greater than zero");
  return wei;
}

async function main(): Promise<void> {
  // Before a chain is built, so a guessed backend cannot get as far as
  // printing a plan that looks real.
  requireDeclaredBackend(readEnv(), envFile);

  const targetWei = parseTarget(values.target);
  const bankTargetWei = parseTarget(values["bank-target"]);
  const ctx = await getServerContext();

  if (!ctx.chain.settles) {
    console.error(`Wallet backend is ${ctx.chain.kind}, which needs no funding.`);
    console.error("Run npm run generate-wallets, fund the first address, then retry.");
    process.exitCode = 1;
    return;
  }

  console.log(`backend ${ctx.chain.kind} on ${ctx.chain.network}, target ${formatEth(targetWei)} ETH per wallet\n`);

  // The bank only exists once a key does. An install that has never generated
  // one funds the seven it has and says nothing about a wallet it lacks.
  const env = readEnv();
  const hasBank = Boolean(env.viem?.keys[BANK_WALLET_ID]);
  const bank = hasBank ? await ctx.chain.open(BANK_WALLET_ID) : null;
  const targetsById: TargetsById = bank ? { [BANK_WALLET_ID]: bankTargetWei } : {};

  const wallets = [...ctx.wallets.agents.values(), ctx.wallets.pot, ...(bank ? [bank] : [])];
  const balances: FundingBalance[] = [];
  for (const wallet of wallets) {
    balances.push({ id: wallet.id, address: wallet.address, balanceWei: await wallet.getBalance() });
  }

  console.log("balances before:");
  for (const b of balances) console.log(`  ${b.id.padEnd(6)} ${b.address}  ${formatEth(b.balanceWei).padStart(12)} ETH`);

  const plan = planFunding(FUNDER_WALLET_ID, balances, targetWei, ctx.chain.gasReserveWei, targetsById);
  if (bank) console.log(`\nbank ${bank.address}, target ${formatEth(bankTargetWei)} ETH`);
  else console.log("\nno bank key, so no bank wallet to fund. Run npm run generate-wallets -- --add to create one.");
  console.log(`\nfunder ${plan.funder.id} holds ${formatEth(plan.funder.balanceWei)} ETH`);
  for (const s of plan.skipped) console.log(`  skip ${s.id.padEnd(6)} already at ${formatEth(s.balanceWei)} ETH`);
  for (const t of plan.transfers) console.log(`  send ${formatEth(t.amountWei).padStart(12)} ETH to ${t.id.padEnd(6)} ${t.address}`);

  if (plan.transfers.length === 0) {
    console.log("\nNothing to do: every wallet is already at the target.");
    return;
  }
  console.log(`\ntotal to send ${formatEth(plan.totalWei)} ETH`);

  // What the funder is left with, and whether it can still take a seat. The
  // funder is an agent too, and paying for everyone else out of its own
  // wallet is the one way this script can quietly take it out of the game.
  const leftWei = plan.funder.balanceWei - plan.totalWei;
  const needsToPlayWei = stakeWeiFrom() + ctx.chain.gasReserveWei;
  // Signed, because this number is allowed to be negative and that is the
  // interesting case: it means the plan spends more than the funder holds.
  const signedEth = (wei: bigint): string => (wei < 0n ? `-${formatEth(-wei)}` : formatEth(wei));
  console.log(`funder keeps ${signedEth(leftWei)} ETH, and needs ${formatEth(needsToPlayWei)} ETH to take a seat`);
  if (leftWei < 0n) {
    console.log(`  this fan out asks ${plan.funder.id} for ${signedEth(-leftWei)} ETH more than it holds, so the bank cannot be funded from it as things stand.`);
  } else if (leftWei < needsToPlayWei) {
    console.log(`  this fan out would leave ${plan.funder.id} unable to enter a round. Top it up before sending.`);
  } else if (leftWei < targetWei) {
    console.log(`  ${plan.funder.id} can still play, but drops below the ${formatEth(targetWei)} ETH every other agent is topped up to.`);
  } else {
    console.log(`  ${plan.funder.id} stays at or above the per agent target, so its own playing balance is untouched.`);
  }

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
