// Whether this round's agents reason, or run on instinct.
//
// A file in the data directory, exactly like the pause file the worker reads
// at the top of every interval: a running process never rereads its
// environment, and an operator who wants to stop paying for reasoning should
// not have to restart the worker or the site to be heard.
//
// The file's presence is off, which makes the default on: a pit that has
// never been switched behaves as it always has. The switch never touches the
// key, so turning reasoning back on needs no credential handling.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Whether SERV may be called for this round. */
export function servReasoningOn(file: string | undefined): boolean {
  // No file configured is a context that predates the switch, such as a test
  // harness. Those keep whatever client they were given.
  if (file === undefined) return true;
  return !existsSync(file);
}

/**
 * Writes the switch, and says what it now is.
 *
 * The file's contents are a courtesy to whoever finds it, not state: only its
 * presence is read, so a half written file still means off.
 */
export function setServReasoning(file: string, on: boolean): boolean {
  if (on) {
    rmSync(file, { force: true });
    return true;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `off since ${new Date().toISOString()}\n`, { mode: 0o600 });
  return false;
}
