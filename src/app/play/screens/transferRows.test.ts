import { describe, expect, it } from "vitest";
import { transferRows, type TransferInput } from "./transferRows";

const entry = (agentId: string, hash: string | null, link: string | null = null): TransferInput => ({
  kind: "entry",
  agentId,
  amountWei: "100",
  txHash: hash,
  link,
});

describe("transferRows", () => {
  it("returns a row per transfer, entries before the payout", () => {
    const rows = transferRows([
      entry("atlas", "0x" + "a".repeat(64)),
      { kind: "payout", agentId: "blaze", amountWei: "2400", txHash: "0x" + "b".repeat(64), link: null },
      entry("comet", "0x" + "c".repeat(64)),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["entry", "entry", "payout"]);
    expect(rows).toHaveLength(3);
  });

  it("shortens a hash for display but keeps the full one for the link", () => {
    const hash = "0x" + "ab".repeat(32);
    const [row] = transferRows([entry("atlas", hash, `https://sepolia.basescan.org/tx/${hash}`)]);
    expect(row.hashShort).toBe(`${hash.slice(0, 8)}...${hash.slice(-6)}`);
    expect(row.link).toBe(`https://sepolia.basescan.org/tx/${hash}`);
    expect(row.hashShort.length).toBeLessThan(hash.length);
  });

  it("says plainly when a transfer has no hash yet rather than showing an empty cell", () => {
    const [row] = transferRows([entry("atlas", null)]);
    expect(row.hashShort).toBe("pending");
    expect(row.link).toBeNull();
  });

  it("carries a local hash with no link, which is what the fake chain produces", () => {
    const hash = "0x" + "9".repeat(64);
    const [row] = transferRows([entry("atlas", hash, null)]);
    expect(row.hashShort).toMatch(/^0x9{6}\.\.\.9{6}$/);
    expect(row.link).toBeNull();
    expect(row.explorable).toBe(false);
  });

  it("marks a row explorable only when the chain gave it a link", () => {
    const hash = "0x" + "d".repeat(64);
    expect(transferRows([entry("a", hash, "https://sepolia.basescan.org/tx/x")])[0].explorable).toBe(true);
    expect(transferRows([entry("a", hash, null)])[0].explorable).toBe(false);
  });

  it("labels the kind for a reader rather than printing the raw word", () => {
    const rows = transferRows([
      entry("atlas", "0x" + "1".repeat(64)),
      { kind: "payout", agentId: "blaze", amountWei: "2400", txHash: "0x" + "2".repeat(64), link: null },
    ]);
    expect(rows[0].label).toBe("atlas paid in");
    expect(rows[1].label).toBe("blaze paid out");
  });

  it("returns nothing for an empty round rather than throwing", () => {
    expect(transferRows([])).toEqual([]);
  });

  it("survives a malformed transfer without taking the result screen down", () => {
    const rows = transferRows([{ kind: "entry", agentId: "atlas", amountWei: "100", txHash: undefined as unknown as null, link: undefined as unknown as null }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].hashShort).toBe("pending");
  });
});

describe("a round a house bot won", () => {
  it("shows where the prize went, so the pot is accounted for", () => {
    // Eighteen of the twenty four entrants are house bots with no wallet, so
    // when one wins there is no payout transfer to make. The result screen
    // used to show three entries against a pot of 2400 and nothing saying
    // where the rest went. The run now reports the retention explicitly.
    const rows = transferRows([
      { kind: "entry", agentId: "blaze", amountWei: "100", txHash: "0xaaa", link: null },
      { kind: "retained", agentId: "bot-03", amountWei: "2400", txHash: null, link: null },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].label).toBe("bot-03 won, prize kept in the pot");
    expect(rows[1].hashShort).toBe("no transfer");
    expect(rows[1].explorable).toBe(false);
  });

  it("sorts the retention last, where the payout would have been", () => {
    const rows = transferRows([
      { kind: "retained", agentId: "bot-03", amountWei: "2400", txHash: null, link: null },
      { kind: "entry", agentId: "blaze", amountWei: "100", txHash: null, link: null },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["entry", "retained"]);
  });

  it("still says pending for a payout whose hash has not arrived", () => {
    const rows = transferRows([{ kind: "payout", agentId: "blaze", amountWei: "2400", txHash: null, link: null }]);
    expect(rows[0].hashShort).toBe("pending");
  });
});
