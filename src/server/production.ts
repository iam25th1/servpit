// What is allowed to exist on a public deployment.
//
// This project ships two flows. The lever flow is the local one: a player
// pulls, and the routes behind it plan a round and settle it, which moves real
// money from wallets whose keys sit on the server. Arena mode is the public
// one: a worker plays the rounds and a viewer watches and backs an agent for
// points.
//
// In production only the public one is served. The lever routes, which write,
// and the development views, which exist to look at the machinery, are closed
// rather than trusted to be unreachable. A flag that has to be right is a
// worse guard than a route that is not there.

/** True when the app is running a production build, as next start sets it. */
export function inProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** What a development only view says when it is asked for in production. */
export const NOT_HERE = "This is a development view and is not served here.";

/** What the lever routes say in production, where the pit runs itself. */
export const LEVER_CLOSED = "The lever is not open here. This pit plays its own rounds.";
