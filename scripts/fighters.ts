// The seats visitors may claim, from a terminal.
//
//   npm run fighters -- status
//   npm run fighters -- cap 8              most seats claimed at once
//   npm run fighters -- reserve 2          seats kept free for somebody new
//   npm run fighters -- release-hours 72   how long a claim survives unvisited
//
// It writes one file in the data directory and nothing else. The site reads
// that file per request, so a limit changed here is in force on the next
// claim without restarting anything.
//
// Status also runs the sweep, which is what gives back the seats nobody has
// come back to. The record behind a released seat is kept, so the same handle
// claiming again carries on the same career.

import { fighterFile, fighterSettingsFile } from "../src/config/fighters";
import { readEnv } from "../src/server/env";
import { FighterStore } from "../src/server/fighters/log";
import { parseFighterCommand, fighterStatusLines } from "../src/server/fighters/command";
import { readFighterSettings, writeFighterSettings } from "../src/server/fighters/settings";
import { CareerStore, careerFile } from "../src/server/fighters/careerStore";
import { loadLocalEnv } from "./lib/loadEnv";

function main(): void {
  loadLocalEnv();
  const env = readEnv();
  const network = env.viem ? "base-sepolia" : "fake";
  const file = fighterSettingsFile(env.dataDir);
  const command = parseFighterCommand(process.argv.slice(2));

  const settings = command.kind === "set" ? writeFighterSettings(file, { ...readFighterSettings(file), ...command.settings }) : readFighterSettings(file);

  const store = new FighterStore(fighterFile(env.dataDir, network), network);
  const released = store.sweep(settings.releaseHours * 60 * 60_000);
  const now = Date.now();
  const careers = new CareerStore(careerFile(env.dataDir, network), network);

  for (const line of fighterStatusLines({
    settings,
    claimed: store.all().length,
    freeFaces: store.freeFaces().length,
    released,
    fighters: store
      .all()
      .map((f) => ({ handle: f.handle, name: f.name, face: f.face, hoursSinceSeen: Math.floor((now - f.seenAt) / (60 * 60_000)) }))
      .sort((a, b) => a.hoursSinceSeen - b.hoursSinceSeen),
  })) {
    console.log(line);
  }
  const records = careers.rows();
  console.log(`records on file: ${records.length}${records.length > 0 ? `, best ${records[0]!.name} with ${records[0]!.wins} wins from ${records[0]!.rounds} rounds` : ""}`);
  console.log(`settings file: ${file}`);
  console.log(`it takes effect on the next claim, in every process, with no restart.`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
