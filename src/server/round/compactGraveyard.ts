// The one time clean up of a graveyard the empty bank loop filled.
//
// The loop wrote the same kind of row about ninety thousand times: an agent
// seated in a wallet with too little to play, refused by an empty bank, and
// retired the next round without having done anything at all. Those rows say
// nothing about any agent and they are most of the file.
//
// A row is taken out only when the row itself proves it is one of those:
//
//   retired as broke and denied credit;
//   never borrowed, owed nothing and had nothing seized;
//   never won, and never entered a round, by its own record;
//   not one of the six originals, which were funded at the start;
//   and a life short enough to be wholly inside the round store's window,
//   because "never entered" is only known for rounds the store still held.
//
// A row missing any field that rule reads is kept. Everything kept goes into
// one compressed file in the new format, and the old single file is renamed,
// not changed, so it sits beside the graveyard as an untouched backup.

import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { generationOf } from "@/config/replacements";
import type { GraveyardOptions } from "@/config/graveyard";
import { withAppendLock } from "../backing/appendLock";
import { readStoreFile } from "../store/file";
import { archiveStamp, graveyardPaths, listArchives, parseGraveyardText, readGraveyard, rotateGraveyard, writeArchive } from "./graveyard";
import { MAX_ROUNDS } from "./store";
import type { WreckRecord } from "./wrecks";

/** Whether a row is one the empty bank loop wrote, judged by the row alone. */
export function isEmptyBankChurn(record: Partial<WreckRecord>): boolean {
  if (record.trigger !== "broke and denied credit") return false;
  if (record.loanCount !== 0 || record.borrowedWei !== "0") return false;
  if (record.debtAtDeathWei !== "0" || record.seizedWei !== "0") return false;
  if (record.wins !== 0) return false;
  if (!Array.isArray(record.recentStakeMultiples) || record.recentStakeMultiples.length !== 0) return false;
  if (typeof record.roundsSurvived !== "number" || record.roundsSurvived >= MAX_ROUNDS) return false;
  if (typeof record.identityId !== "string" || generationOf(record.identityId) <= 1) return false;
  return true;
}

export interface FileSize {
  file: string;
  bytes: number;
  rows: number;
}

export interface CompactReport {
  network: string;
  dryRun: boolean;
  /** Every file the pit reads, before. */
  before: FileSize[];
  /** Every file the pit reads, after. On a dry run, what they would be. */
  after: FileSize[];
  /** The old single file, renamed. Null when there was none or on a dry run. */
  backup: FileSize | null;
  rowsBefore: number;
  rowsKept: number;
  churnRemoved: number;
  /** True when churn was left in on purpose, so the run only rotated and compressed. */
  keptChurn: boolean;
}

function rowsIn(file: string, network: string): number {
  if (file.endsWith(".json")) {
    const body = readStoreFile(file, network);
    return Array.isArray(body?.wrecks) ? body.wrecks.length : 0;
  }
  const bytes = readFileSync(file);
  return parseGraveyardText(file.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"), file, network).length;
}

function sizes(file: string, network: string): FileSize[] {
  const paths = graveyardPaths(file);
  const files = [...(existsSync(paths.legacy) ? [paths.legacy] : []), ...listArchives(paths).map((a) => a.file), ...(existsSync(paths.active) ? [paths.active] : [])];
  return files.map((f) => ({ file: f, bytes: statSync(f).size, rows: rowsIn(f, network) }));
}

/**
 * Compacts one network's graveyard.
 *
 * The heavy part, reading and filtering the old file and writing what is
 * kept, needs no lock: no build that has this file writes the old single
 * file, so it cannot change underneath. The active file is set aside under
 * the same lock every append takes.
 *
 * Refuses an old single file written in the last ten minutes unless forced,
 * because that is an older build still running and still rewriting it.
 */
export function compactGraveyard(options: {
  file: string;
  network: string;
  graveyard: GraveyardOptions;
  dryRun?: boolean;
  keepChurn?: boolean;
  force?: boolean;
  now?: number;
}): CompactReport {
  const now = options.now ?? Date.now();
  const paths = graveyardPaths(options.file);
  const before = sizes(options.file, options.network);
  const rowsBefore = readGraveyard(options.file, options.network)?.length ?? 0;

  let kept: WreckRecord[] = [];
  let removed = 0;
  const legacyThere = existsSync(paths.legacy);
  if (legacyThere) {
    const recent = now - statSync(paths.legacy).mtimeMs < 10 * 60 * 1000;
    if (recent && !options.force) {
      throw new Error(`${basename(paths.legacy)} was written in the last ten minutes, so an older build may still be running and rewriting it. Stop the pit first, or pass --force.`);
    }
    const body = readStoreFile(paths.legacy, options.network);
    const rows = Array.isArray(body?.wrecks) ? (body.wrecks as WreckRecord[]) : [];
    kept = options.keepChurn ? rows : rows.filter((r) => !isEmptyBankChurn(r));
    removed = rows.length - kept.length;
  }

  if (options.dryRun) {
    const afterRows = rowsBefore - removed;
    return { network: options.network, dryRun: true, before, after: [{ file: "(not written on a dry run)", bytes: 0, rows: afterRows }], backup: null, rowsBefore, rowsKept: afterRows, churnRemoved: removed, keptChurn: Boolean(options.keepChurn) };
  }

  let backup: FileSize | null = null;
  if (legacyThere) {
    // Written and read back before anything is renamed, so there is never a
    // moment where a reader finds less than it should.
    const startedAt = kept.length > 0 ? kept.reduce((first, r) => (r.at < first ? r.at : first), kept[0].at) : new Date(now).toISOString();
    const archive = writeArchive(paths, options.network, startedAt, kept);
    const back = parseGraveyardText(gunzipSync(readFileSync(archive)).toString("utf8"), archive, options.network);
    if (back.length !== kept.length) throw new Error(`${basename(archive)} read back ${back.length} rows of ${kept.length}. The old file is untouched.`);
    const target = `${paths.legacy}.backup-${archiveStamp(new Date(now).toISOString())}`;
    const bytes = statSync(paths.legacy).size;
    renameSync(paths.legacy, target);
    backup = { file: target, bytes, rows: removed + kept.length };
  }

  withAppendLock(paths.active, () => rotateGraveyard(paths, options.graveyard, now));

  const after = sizes(options.file, options.network);
  const rowsKept = readGraveyard(options.file, options.network)?.length ?? 0;
  return { network: options.network, dryRun: false, before, after, backup, rowsBefore, rowsKept, churnRemoved: removed, keptChurn: Boolean(options.keepChurn) };
}
