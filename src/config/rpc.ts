// Which Base Sepolia endpoints the server reads from, and in what order.
//
// Data only, shared by the environment reader and the chain, so the default
// list lives in one place rather than in whichever of them happened to need
// it first. No secrets here.

/**
 * Endpoints tried in order.
 *
 * Order chosen by measurement rather than by reputation. Four endpoints were
 * given seven eth_getBalance calls back to back, which is the sweep a round
 * makes: publicnode answered all seven in 1.3 s, the chain's own
 * sepolia.base.org in 1.9 s, drpc in 3.3 s, and 1rpc.io returned "unknown
 * network" on every one.
 *
 * There is more than one now because a single endpoint is a single point of
 * failure, and it failed: one eth_getBalance timed out against publicnode and
 * took the whole decision phase with it.
 */
export const DEFAULT_RPC_URLS = ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org", "https://base-sepolia.drpc.org"] as const;

/** The first endpoint, for the one place that still needs a single url. */
export const DEFAULT_RPC_URL = DEFAULT_RPC_URLS[0];
