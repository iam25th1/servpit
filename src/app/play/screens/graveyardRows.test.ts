import { describe, expect, it } from "vitest";
import { GRAVES_PER_PAGE, graveyardPage, type GraveShape } from "./graveyardRows";

const grave = (name: string, at: string, extra: Partial<GraveShape> = {}): GraveShape => ({
  walletId: name.toLowerCase(),
  identityId: `${name.toLowerCase()}-1`,
  name,
  face: null,
  cause: "ran out of credit",
  roundsSurvived: 4,
  wins: 1,
  peakBalance: 120,
  debtAtDeath: 0,
  at,
  ...extra,
});

const many = (count: number): GraveShape[] =>
  Array.from({ length: count }, (_, i) => grave(`Agent${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));

describe("graveyardPage", () => {
  it("puts the most recent grave first, whatever order the store held", () => {
    const page = graveyardPage([grave("Old", "2026-01-01T00:00:00.000Z"), grave("New", "2026-02-01T00:00:00.000Z")], 0);
    expect(page.rows.map((r) => r.name)).toEqual(["New", "Old"]);
  });

  it("fills one page and says where in the whole it sits", () => {
    const page = graveyardPage(many(37), 0);
    expect(page.rows).toHaveLength(GRAVES_PER_PAGE);
    expect(page.total).toBe(37);
    expect(page.label).toBe(`1 to ${GRAVES_PER_PAGE} of 37`);
    expect(page.hasOlder).toBe(true);
    expect(page.hasNewer).toBe(false);
  });

  it("walks back through the older pages", () => {
    const page = graveyardPage(many(37), 1);
    expect(page.label).toBe(`${GRAVES_PER_PAGE + 1} to ${GRAVES_PER_PAGE * 2} of 37`);
    expect(page.hasNewer).toBe(true);
    expect(page.hasOlder).toBe(true);
  });

  it("counts the last page by what is actually on it, not by the page size", () => {
    const last = Math.ceil(37 / GRAVES_PER_PAGE) - 1;
    const page = graveyardPage(many(37), last);
    expect(page.label).toBe(`${last * GRAVES_PER_PAGE + 1} to 37 of 37`);
    expect(page.hasOlder).toBe(false);
    expect(page.rows.length).toBeLessThanOrEqual(GRAVES_PER_PAGE);
  });

  it("clamps a page past the end rather than showing an empty slab", () => {
    const page = graveyardPage(many(3), 9);
    expect(page.rows).toHaveLength(3);
    expect(page.page).toBe(0);
  });

  it("says plainly when nobody has died yet", () => {
    const page = graveyardPage([], 0);
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.label).toBe("nobody yet");
    expect(page.hasOlder).toBe(false);
    expect(page.hasNewer).toBe(false);
  });

  it("keeps each grave's own cause, which is not the same story for everyone", () => {
    const rows = graveyardPage(
      [grave("Reacher", "2026-01-02T00:00:00.000Z", { cause: "over-reached", debtAtDeath: 30 }), grave("Quiet", "2026-01-01T00:00:00.000Z")],
      0,
    ).rows;
    expect(rows.map((r) => r.cause)).toEqual(["over-reached", "ran out of credit"]);
    expect(rows[0].debtAtDeath).toBe(30);
  });
});
