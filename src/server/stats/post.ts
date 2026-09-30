// The five or six lines that would actually read well in a post.
//
// Picked from the same counted numbers as the report, by one rule: a number
// that is not impressive is left out rather than dressed up. So each candidate
// carries the floor it has to clear, and a pit that has not done the thing yet
// simply has one fewer line. Nothing here rounds up, restates a small number
// as a percentage, or describes an absence as a result.
//
// The lines are ordered by how well they read rather than by size, and the
// first six that clear their floor are the ones printed.

import type { Report, Stat } from "./collect";

/** How many lines a post wants. */
export const POST_LINES = 6;

interface Candidate {
  /** The stat this line is built from, by the label the report gave it. */
  label: string;
  /** The floor the number has to clear to be worth saying. */
  floor: number;
  line: (stat: Stat, report: Report) => string;
}

const find = (report: Report, label: string): Stat | undefined => {
  for (const group of report.groups) {
    const found = group.stats.find((stat) => stat.label === label);
    if (found) return found;
  }
  return undefined;
};

const CANDIDATES: Candidate[] = [
  {
    label: "transactions on chain",
    floor: 250,
    line: (stat) => `Six agents with their own wallets have moved money ${stat.text} times on Base Sepolia. Every one of those transfers has a hash.`,
  },
  {
    label: "agents wrecked",
    floor: 25,
    line: (stat, report) => {
      const finished = find(report, "what finished them");
      return `${stat.text} agents have gone broke in the pit and been replaced${finished?.text ? `: ${finished.text}` : ""}.`;
    },
  },
  {
    label: "best fighter career",
    floor: 3,
    line: (stat) => `The best fighter a visitor has claimed: ${stat.text}.`,
  },
  {
    label: "moved in total",
    floor: 5_000,
    line: (stat) => `${stat.text} have gone through the pot, entry by entry, with nobody playing.`,
  },
  {
    label: "largest pot on file",
    floor: 100,
    line: (stat) => `Biggest pot on file: ${stat.text}, won by one fighter in a field of twenty four.`,
  },
  {
    label: "written off",
    floor: 100,
    line: (stat) => `Marrow, the lender, has written off ${stat.text} on agents that died owing it.`,
  },
  {
    label: "kills recorded for claimed fighters (the only kills any store keeps)",
    floor: 250,
    line: (stat) => `${stat.text} kills recorded for the seats visitors claimed as their own.`,
  },
  {
    label: "what those rounds cover",
    floor: 2,
    line: (stat, report) => {
      const rounds = find(report, "rounds on file");
      return `${rounds?.text ?? "The"} rounds in the last ${stat.text?.split(",")[0]}, played by a worker on one Mac.`;
    },
  },
  {
    label: "rounds that failed reconciliation",
    floor: 0,
    line: (stat, report) => {
      const reconciled = find(report, "rounds reconciled");
      return `Every round on file reconciled against chain balances: ${reconciled?.text}.`;
    },
  },
  {
    label: "spend on reasoning",
    floor: 1,
    line: (stat) => `The reasoning bill so far: ${stat.text}.`,
  },
];

/**
 * The lines worth posting, in the order they read best.
 *
 * A candidate with no number, a number under its floor, or a stat the stores
 * did not record is skipped. The reconciliation line is the one candidate that
 * wants a zero, so it clears its floor only when nothing failed.
 */
export function postLines(report: Report, want: number = POST_LINES): string[] {
  const lines: string[] = [];
  for (const candidate of CANDIDATES) {
    if (lines.length >= want) break;
    const stat = find(report, candidate.label);
    if (stat === undefined || stat.text === null || stat.number === undefined) continue;
    const clears = candidate.label === "rounds that failed reconciliation" ? stat.number === 0 : stat.number >= candidate.floor;
    if (!clears) continue;
    lines.push(candidate.line(stat, report));
  }
  return lines;
}
