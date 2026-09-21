// How every persistent store reads and writes its file.
//
// Two things are not left to each store to remember.
//
// ATOMIC WRITES. A store writes to a temporary file, flushes it to the disk,
// and renames it into place. Rename is atomic, so a reader sees either the
// old file or the new one and never half of either. The temporary name
// carries the process id and a counter, because a fixed one is shared: two
// writers of the same store would take turns truncating one temporary file
// and then rename whatever was in it, which is the truncation this is meant
// to prevent.
//
// ONE NETWORK PER FILE. The file names carry the network, which is a
// convention a copied or renamed file breaks. The network is written inside
// the file as well and checked on every read, so fake chain data cannot be
// read as real chain data whatever the file is called. A file written before
// the stamp existed has no network and is adopted by the first store that
// opens it, which is how the existing data is kept.
//
// STALENESS. One process holds more than one store over the same file: the
// plan route builds the server context and the run route builds the settle
// context, because the settle path may not import anything that can reach a
// model. A store that read its file once at construction went stale the
// moment the other one wrote, so reads go through a stamp check first.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** Raised when a file belongs to a different chain than the one running. */
export class StoreNetworkMismatch extends Error {
  constructor(
    readonly file: string,
    readonly found: string,
    readonly expected: string,
  ) {
    super(`${file} holds ${found} data and this process is on ${expected}. Refusing to read it.`);
    this.name = "StoreNetworkMismatch";
  }
}

/** Modification time and size, which is what says a file has changed. */
export function storeStamp(file: string): string {
  const stat = statSync(file, { throwIfNoEntry: false });
  return stat ? `${stat.mtimeMs}:${stat.size}` : "";
}

let counter = 0;

/**
 * Writes a store file atomically, stamped with its network.
 *
 * The temporary file is flushed before the rename, so a crash cannot leave a
 * file whose name says it is complete and whose contents are the tail of a
 * write that never finished.
 *
 * The directory itself is not flushed. That would make the rename survive a
 * power cut as well, and it measured as half the cost of a write again on
 * this filesystem, about 8 ms each against the dozens of writes a round
 * makes. Without it a power cut can cost the last write, which leaves the
 * previous whole store on disk. That is the property this is here for: old
 * and complete, never new and truncated.
 */
export function writeStoreFile(file: string, body: object, network: string): string {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify({ network, ...body }, null, 2) + "\n";
  const temp = `${file}.${process.pid}.${counter++}.tmp`;
  const handle = openSync(temp, "w", 0o600);
  try {
    writeSync(handle, text);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    renameSync(temp, file);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {
      // The rename is what matters. A temporary file left behind is litter,
      // not a corrupted store.
    }
    throw e;
  }
  return storeStamp(file);
}

/**
 * Reads a store file, or null when it is not there yet.
 *
 * A file stamped with another network is refused rather than merged: on a
 * money surface, reading a fake chain's debts as real ones is worse than
 * failing to start.
 */
export function readStoreFile(file: string, network: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const found = parsed.network;
  if (typeof found === "string" && found !== network) throw new StoreNetworkMismatch(file, found, network);
  return parsed;
}

/**
 * The read and write half of a store, without the parsing.
 *
 * Built inside a store's constructor rather than as a field, so every field
 * the load callback touches has already been initialised when the first read
 * runs. A field initialiser would run after it and quietly undo the load.
 */
export class StoreFile {
  /** Null until the first read, because an absent file stamps as empty too. */
  private stamp: string | null = null;

  constructor(
    private readonly file: string,
    private readonly network: string,
    /** Called with the parsed file, or null when there is nothing on disk. */
    private readonly onLoad: (body: Record<string, unknown> | null) => void,
  ) {}

  /** Loads the file when it has changed since the last look. */
  read(): void {
    const stamp = storeStamp(this.file);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.onLoad(stamp === "" ? null : readStoreFile(this.file, this.network));
  }

  /** Writes the file and records it as read, so the next read is a no op. */
  write(body: object): void {
    this.stamp = writeStoreFile(this.file, body, this.network);
  }
}

/** The network a store writes with when the caller has no chain, as in a test. */
export const UNKNOWN_NETWORK = "unknown";
