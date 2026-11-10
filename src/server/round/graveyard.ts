// The graveyard on disk: one line per retirement, in files that rotate.
//
// THE FILES, for a store opened on wrecks-base-sepolia.json:
//
//   wrecks-base-sepolia.json            what every earlier build wrote, one
//                                       JSON body rewritten whole on every
//                                       retirement. Read, never written.
//   wrecks-base-sepolia.ndjson          where new lines are appended. The
//                                       first line names the network and
//                                       the moment the file was started.
//   wrecks-base-sepolia.<stamp>.ndjson.gz
//                                       files set aside, compressed, named
//                                       for when they were started so the
//                                       names sort oldest first.
//
// A reader reads all of them, oldest first, and a later line for the same
// round and seat replaces an earlier one, which is what saving the same
// retirement twice always did.
//
// ROTATION. Before a line is appended, the file is set aside when it has
// reached the size limit or was started on an earlier day, by UTC. Setting
// aside is a rename, then a compression to a temporary name, a flush, a
// rename into place, and only then is the uncompressed copy removed. A crash
// at any point leaves either the uncompressed copy, which readers still read
// and the next rotation compresses, or both, in which case readers take the
// compressed one. Then the oldest files beyond the number kept are removed.
//
// Everything that writes takes the append lock on the active file, so a
// rotation and an append can never interleave.

import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { GraveyardOptions } from "@/config/graveyard";
import { withAppendLock } from "../backing/appendLock";
import { StoreNetworkMismatch, readStoreFile, storeStamp } from "../store/file";
import type { WreckRecord } from "./wrecks";

export interface GraveyardPaths {
  dir: string;
  /** The file name without its extension, which every file here starts with. */
  stem: string;
  /** The single body earlier builds rewrote. Read only. */
  legacy: string;
  /** Where new lines go. */
  active: string;
}

/** A set aside file, and whether it is compressed yet. */
export interface GraveyardArchive {
  stamp: string;
  file: string;
  compressed: boolean;
}

type HeadLine = { k: "head"; network: string; startedAt: string };

/** The paths for a store opened on its old single file name. */
export function graveyardPaths(file: string): GraveyardPaths {
  const dir = dirname(file);
  const stem = basename(file).replace(/\.(json|ndjson)$/, "");
  return { dir, stem, legacy: join(dir, `${stem}.json`), active: join(dir, `${stem}.ndjson`) };
}

/** 2026-11-09T17:48:05.123Z as 20261109T174805123Z, which sorts as it reads. */
export function archiveStamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every set aside file, oldest first, with a compressed copy preferred. */
export function listArchives(paths: GraveyardPaths): GraveyardArchive[] {
  let names: string[];
  try {
    names = readdirSync(paths.dir);
  } catch {
    return [];
  }
  const pattern = new RegExp(`^${escapeRegExp(paths.stem)}\\.(\\d{8}T\\d{9}Z(?:-\\d+)?)\\.ndjson(\\.gz)?$`);
  const byStamp = new Map<string, GraveyardArchive>();
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const archive = { stamp: match[1], file: join(paths.dir, name), compressed: match[2] === ".gz" };
    const held = byStamp.get(archive.stamp);
    if (!held || (archive.compressed && !held.compressed)) byStamp.set(archive.stamp, archive);
  }
  return [...byStamp.values()].sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0));
}

/** The lines of one file as records, refusing a file from another network. */
export function parseGraveyardText(text: string, file: string, network: string): WreckRecord[] {
  const records: WreckRecord[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // A line cut short by a crash. The lines either side of it are whole.
      continue;
    }
    if (line.k === "head") {
      if (typeof line.network === "string" && line.network !== network) throw new StoreNetworkMismatch(file, line.network, network);
      continue;
    }
    if (line.k !== "wreck") continue;
    const record = { ...line };
    delete record.k;
    records.push(record as unknown as WreckRecord);
  }
  return records;
}

function readArchive(archive: GraveyardArchive, network: string): WreckRecord[] {
  const bytes = readFileSync(archive.file);
  return parseGraveyardText(archive.compressed ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"), archive.file, network);
}

function readLegacy(file: string, network: string): WreckRecord[] {
  const body = readStoreFile(file, network);
  return Array.isArray(body?.wrecks) ? (body.wrecks as WreckRecord[]) : [];
}

/** Oldest first, with a later record for the same round and seat replacing an earlier one in place. */
export function mergeWrecks(parts: ReadonlyArray<ReadonlyArray<WreckRecord>>): WreckRecord[] {
  const byKey = new Map<string, WreckRecord>();
  for (const part of parts) for (const record of part) byKey.set(`${record.roundId}\n${record.walletId}`, record);
  return [...byKey.values()];
}

/** The files a reader reads, oldest first, with what says each has changed. */
function sources(paths: GraveyardPaths): Array<{ file: string; stamp: string; read: (network: string) => WreckRecord[] }> {
  const out: Array<{ file: string; stamp: string; read: (network: string) => WreckRecord[] }> = [];
  const legacyStamp = storeStamp(paths.legacy);
  if (legacyStamp !== "") out.push({ file: paths.legacy, stamp: legacyStamp, read: (network) => readLegacy(paths.legacy, network) });
  for (const archive of listArchives(paths)) {
    const stamp = storeStamp(archive.file);
    if (stamp !== "") out.push({ file: archive.file, stamp, read: (network) => readArchive(archive, network) });
  }
  const activeStamp = storeStamp(paths.active);
  if (activeStamp !== "") out.push({ file: paths.active, stamp: activeStamp, read: (network) => parseGraveyardText(readFileSync(paths.active, "utf8"), paths.active, network) });
  return out;
}

/**
 * Every retirement on file, or null when there is no graveyard at all.
 *
 * Null rather than empty, for a report that has to tell a store that is not
 * there from one with nothing in it.
 */
export function readGraveyard(file: string, network: string): WreckRecord[] | null {
  const paths = graveyardPaths(file);
  const found = sources(paths);
  if (found.length === 0) return null;
  return mergeWrecks(found.map((s) => s.read(network)));
}

/**
 * The same read, kept between calls.
 *
 * A set aside file never changes, so it is parsed once. The active file is
 * small by construction and is parsed again only when it changes. The old
 * single file, while it is still there, is parsed once.
 */
export class GraveyardCache {
  private parsed = new Map<string, { stamp: string; records: WreckRecord[] }>();
  private key = "";
  private merged: WreckRecord[] = [];

  constructor(
    private readonly paths: GraveyardPaths,
    private readonly network: string,
  ) {}

  records(): WreckRecord[] {
    const found = sources(this.paths);
    const key = found.map((s) => `${s.file}@${s.stamp}`).join("|");
    if (key === this.key) return this.merged;
    const next = new Map<string, { stamp: string; records: WreckRecord[] }>();
    for (const source of found) {
      const held = this.parsed.get(source.file);
      next.set(source.file, held && held.stamp === source.stamp ? held : { stamp: source.stamp, records: source.read(this.network) });
    }
    this.parsed = next;
    this.merged = mergeWrecks(found.map((s) => next.get(s.file)!.records));
    this.key = key;
    return this.merged;
  }
}

/** The active file's first line, or null when it has none that parses. */
function readHead(file: string): { head: HeadLine; bytes: number } | null {
  let handle: number;
  try {
    handle = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(4096);
    const read = readSync(handle, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const end = text.indexOf("\n");
    if (end < 0) return null;
    const line = JSON.parse(text.slice(0, end)) as Partial<HeadLine>;
    if (line.k !== "head" || typeof line.network !== "string" || typeof line.startedAt !== "string") return null;
    return { head: line as HeadLine, bytes: Buffer.byteLength(text.slice(0, end + 1)) };
  } catch {
    return null;
  } finally {
    closeSync(handle);
  }
}

function startActive(paths: GraveyardPaths, network: string, now: number): void {
  if (existsSync(paths.active)) return;
  mkdirSync(paths.dir, { recursive: true });
  const head: HeadLine = { k: "head", network, startedAt: new Date(now).toISOString() };
  writeFileSync(paths.active, `${JSON.stringify(head)}\n`, { flag: "wx", mode: 0o600 });
}

/** A file whose last write was cut short gets its line ended, so the next one starts clean. */
function endLastLine(file: string): void {
  const size = statSync(file).size;
  if (size === 0) return;
  const handle = openSync(file, "r");
  try {
    const last = Buffer.alloc(1);
    readSync(handle, last, 0, 1, size - 1);
    if (last[0] !== 0x0a) appendFileSync(file, "\n");
  } finally {
    closeSync(handle);
  }
}

/** Whether the active file should be set aside before another line goes in. */
export function rotationDue(paths: GraveyardPaths, options: GraveyardOptions, now: number): boolean {
  const stat = statSync(paths.active, { throwIfNoEntry: false });
  if (!stat) return false;
  const head = readHead(paths.active);
  // Nothing but a head line: there is nothing worth keeping to set aside.
  if (head !== null && stat.size <= head.bytes) return false;
  if (stat.size >= options.maxBytes) return true;
  const started = head?.head.startedAt ?? new Date(stat.mtimeMs).toISOString();
  return started.slice(0, 10) !== new Date(now).toISOString().slice(0, 10);
}

/** Compresses one set aside file, leaving only the compressed copy. */
function compressArchive(file: string): string {
  const target = `${file}.gz`;
  const temp = `${target}.${process.pid}.tmp`;
  const handle = openSync(temp, "w", 0o600);
  try {
    writeSync(handle, gzipSync(readFileSync(file)));
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temp, target);
  unlinkSync(file);
  return target;
}

/**
 * Sets the active file aside, compresses whatever is waiting to be, and
 * removes the oldest files beyond the number kept.
 *
 * Call it with the append lock held. Returns the compressed file the active
 * one became, or null when there was no active file to set aside.
 */
export function rotateGraveyard(paths: GraveyardPaths, options: GraveyardOptions, now: number = Date.now()): string | null {
  let rotated: string | null = null;
  if (existsSync(paths.active)) {
    const head = readHead(paths.active);
    const base = archiveStamp(head?.head.startedAt ?? new Date(now).toISOString());
    const taken = new Set(listArchives(paths).map((a) => a.stamp));
    let stamp = base;
    for (let n = 1; taken.has(stamp); n++) stamp = `${base}-${n}`;
    rotated = join(paths.dir, `${paths.stem}.${stamp}.ndjson`);
    renameSync(paths.active, rotated);
  }
  let compressed: string | null = null;
  for (const archive of listArchives(paths)) {
    if (archive.compressed) {
      // A copy left behind by a rotation that stopped after compressing.
      const plain = archive.file.slice(0, -".gz".length);
      if (existsSync(plain)) unlinkSync(plain);
      continue;
    }
    const done = compressArchive(archive.file);
    if (archive.file === rotated) compressed = done;
  }
  pruneArchives(paths, options.keep);
  return compressed;
}

/** Removes the oldest set aside files beyond the number kept. */
export function pruneArchives(paths: GraveyardPaths, keep: number): string[] {
  const archives = listArchives(paths);
  const removed: string[] = [];
  for (const archive of archives.slice(0, Math.max(0, archives.length - keep))) {
    for (const file of [archive.file, archive.compressed ? archive.file.slice(0, -".gz".length) : `${archive.file}.gz`]) {
      if (existsSync(file)) {
        unlinkSync(file);
        removed.push(file);
      }
    }
  }
  return removed;
}

/**
 * Appends one retirement, setting the active file aside first when it is due.
 *
 * One line, never the whole graveyard: a retirement costs the same to record
 * on the first day as on the hundredth.
 */
export function appendWreck(paths: GraveyardPaths, network: string, record: WreckRecord, options: GraveyardOptions, now: number = Date.now()): void {
  mkdirSync(paths.dir, { recursive: true });
  withAppendLock(paths.active, () => {
    if (rotationDue(paths, options, now)) rotateGraveyard(paths, options, now);
    startActive(paths, network, now);
    const head = readHead(paths.active);
    if (head && head.head.network !== network) throw new StoreNetworkMismatch(paths.active, head.head.network, network);
    endLastLine(paths.active);
    appendFileSync(paths.active, `${JSON.stringify({ k: "wreck", ...record })}\n`, { mode: 0o600 });
  });
}

/** Writes a whole set aside file at once, compressed, for the one time compaction script. */
export function writeArchive(paths: GraveyardPaths, network: string, startedAt: string, records: ReadonlyArray<WreckRecord>): string {
  mkdirSync(paths.dir, { recursive: true });
  const taken = new Set(listArchives(paths).map((a) => a.stamp));
  const base = archiveStamp(startedAt);
  let stamp = base;
  for (let n = 1; taken.has(stamp); n++) stamp = `${base}-${n}`;
  const lines = [JSON.stringify({ k: "head", network, startedAt } satisfies HeadLine), ...records.map((r) => JSON.stringify({ k: "wreck", ...r }))];
  const target = join(paths.dir, `${paths.stem}.${stamp}.ndjson.gz`);
  const temp = `${target}.${process.pid}.tmp`;
  const handle = openSync(temp, "wx", 0o600);
  try {
    writeSync(handle, gzipSync(Buffer.from(`${lines.join("\n")}\n`, "utf8")));
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temp, target);
  return target;
}
