// Reads the live balances for every wallet. Addresses and balances only.
import { loadLocalEnv } from "../lib/loadEnv";
loadLocalEnv();
import { createBalanceReader } from "../../src/server/wallets/viem";
import { toChips } from "../../src/config/stake";

const WALLETS: Array<[string, string]> = [
  ["atlas", "0x1aC16dC29f2ACf1A628BA28fAce094d152F1197e"],
  ["blaze", "0x03f6ECA7920733207d53c806d127f4bA94f6Efa6"],
  ["comet", "0x41c3ea03fe50964D659Ab8c1DF866de63DF42C50"],
  ["delta", "0x035339ae621d9592C60542585f8051C220E1230a"],
  ["ember", "0xf9f5AA50C62b6236359577E9AEb22B9692D2B84E"],
  ["flint", "0x317EBDfAB7b689Dd9317383170479D4E0F6664A0"],
  ["pot", "0x603e2dD2cBAe814cEed7eCd7D3f205e2F6799BdE"],
  ["bank", "0xfBeC0422C685cAE12d89c59E1aA4Fce4dD38bb67"],
  ["operator", "0xA0F963841EcC29b0663bb6eA583097cAA49835FC"],
];

const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);

async function main(): Promise<void> {
  const balances = await createBalanceReader().readBalances(WALLETS.map(([, a]) => a));
  for (const [i, [name, address]] of WALLETS.entries()) {
    const wei = balances[i];
    if (wei === null || wei === undefined) {
      console.log(`${name.padEnd(9)} ${address} unreadable`);
      continue;
    }
    console.log(`${name.padEnd(9)} ${address} ${toChips(wei)} chips = ${eth(wei)} ETH`);
  }
}
main();
