// The report as text, with the absences as plain as the numbers.
//
// One column of labels and one of values, so a line that says not recorded
// lines up with the numbers around it rather than hiding among them.

import type { Report } from "./collect";
import { postLines } from "./post";

const WIDTH = 42;

export function renderReport(report: Report): string {
  const out: string[] = [];
  out.push(`servpit, ${report.network}`);
  out.push(`read from ${report.dataDir} at ${report.at}`);
  out.push("nothing here was written to, and nothing here is estimated");

  for (const group of report.groups) {
    out.push("");
    out.push(group.title.toUpperCase());
    for (const stat of group.stats) {
      // A label longer than the column gets two spaces rather than none, so a
      // long one never runs into its own value.
      const label = stat.label.length >= WIDTH ? `${stat.label}  ` : stat.label.padEnd(WIDTH, " ");
      out.push(stat.text === null ? `  ${label}not recorded: ${stat.why}` : `  ${label}${stat.text}`);
    }
  }

  const lines = postLines(report);
  out.push("");
  out.push("LINES WORTH POSTING");
  if (lines.length === 0) out.push("  nothing on file clears the bar yet, which is itself worth knowing");
  for (const [at, line] of lines.entries()) out.push(`  ${at + 1}. ${line}`);
  out.push("");
  return out.join("\n");
}
