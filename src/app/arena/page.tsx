import { notFound } from "next/navigation";
import { ArenaClient } from "./ArenaClient";
import { parseArenaParams } from "./params";
import { inProduction } from "@/server/production";

// The fight viewer, driven by a seed in the query string. It exists to look at
// the renderer while building it, and a seed box on a public deployment is an
// invitation to ask what a seed does. Not served in production.
export default async function ArenaPage({ searchParams }: PageProps<"/arena">) {
  if (inProduction()) notFound();
  const { seed, entrants } = parseArenaParams(await searchParams);
  return <ArenaClient seed={seed} entrants={entrants} />;
}
