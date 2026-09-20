import { ArenaClient } from "./ArenaClient";
import { parseArenaParams } from "./params";

export default async function ArenaPage({ searchParams }: PageProps<"/arena">) {
  const { seed, entrants } = parseArenaParams(await searchParams);
  return <ArenaClient seed={seed} entrants={entrants} />;
}
