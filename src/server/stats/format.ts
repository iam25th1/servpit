// The report as text, with the absences as plain as the numbers.
//
// One column of labels and one of values, so a line that says not recorded
// lines up with the numbers around it rather than hiding among them.

import type { Report } from "./collect";
import { postLines } from "./post";

const WIDTH = 42;

/** Prose at a readable width, because a terminal is not a text editor. */
function wrap(text: string, indent: number, columns = 96): string[] {
  const pad = " ".repeat(indent);
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length > 0 && `${line} ${word}`.length > columns - indent) {
      out.push(pad + line);
      line = word;
      continue;
    }
    line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) out.push(pad + line);
  return out;
}

export function renderReport(report: Report): string {
  const out: string[] = [];
  out.push(`servpit, ${report.network}`);
  out.push(`read from ${report.dataDir} at ${report.at}`);
  out.push("nothing here was written to, and nothing here is estimated");

  for (const group of report.groups) {
    out.push("");
    out.push(group.title.toUpperCase());
    // Where the last figure came from, so a run of figures out of the same
    // store says it once rather than on every line.
    let lastCovers = "";
    for (const stat of group.stats) {
      // A label longer than the column gets two spaces rather than none, so a
      // long one never runs into its own value.
      const label = stat.label.length >= WIDTH ? `${stat.label}  ` : stat.label.padEnd(WIDTH, " ");
      out.push(stat.text === null ? `  ${label}not recorded: ${stat.why}` : `  ${label}${stat.text}`);
      const parts: string[] = [];
      if (stat.note !== undefined) parts.push(stat.note);
      if (stat.covers !== undefined && stat.covers !== lastCovers) parts.push(`from ${stat.covers}`);
      if (stat.covers !== undefined) lastCovers = stat.covers;
      if (parts.length > 0) out.push(`${" ".repeat(6)}${parts.join("; ")}`);
    }
  }

  if (report.notes.length > 0) {
    out.push("");
    out.push("WHERE THESE FIGURES COME FROM");
    for (const note of report.notes) out.push(...wrap(note, 2));
  }

  const lines = postLines(report);
  out.push("");
  out.push("LINES WORTH POSTING");
  if (lines.length === 0) out.push("  nothing on file clears the bar yet, which is itself worth knowing");
  for (const [at, line] of lines.entries()) out.push(`  ${at + 1}. ${line}`);
  out.push("");
  return out.join("\n");
}
