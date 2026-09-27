// What a first time visitor is told, before anything happens.
//
// The pit explains itself badly on its own: six agents deciding with their own
// money, a lender, a draw and a fight all happen at once, and a visitor who
// arrives mid round sees figures moving with nothing saying whose they are.
// So there are a few short screens, in plain words, once.
//
// Content lives here rather than in the component, so the wording is testable
// and so the two modes can differ by one screen rather than by a fork in the
// markup. Arena mode has a part for the viewer, backing, which the lever flow
// does not: there the round starts when the player pulls, and the plan route
// hands out the seed, so a pick would be a pick on a known result.

export interface OnboardingScreen {
  /** A short heading, two or three words. */
  title: string;
  /** One or two sentences each. Read in order. */
  lines: string[];
}

/** Where a visitor's "I have read this" is kept. */
export const ONBOARDING_KEY = "servpit.onboarding.seen";

/** The slice of Storage this uses. Same shape the backing handle uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const AGENTS: OnboardingScreen = {
  title: "What this is",
  lines: [
    "A live test of AI agents with money. Six agents hold real wallets on Base Sepolia, and every round each one decides whether to buy a seat in the pit, borrow, or keep its chips.",
    "Nobody plays them. Every choice moves real test funds, and an agent that plays badly goes broke.",
  ],
};

const REASONING: OnboardingScreen = {
  title: "What SERV does",
  lines: [
    "When a round reasons, every agent asks SERV Reasoning whether to buy in and how much to stake, from its balance, its debts and how its last rounds went. Marrow, the lender, asks it who to lend to.",
    "Every answer on screen is labelled: reasoned by SERV, learned from past SERV answers, or on instinct when the model was not asked.",
  ],
};

const CALLS: OnboardingScreen = {
  title: "Your game: call it",
  lines: [
    "Between rounds, predict which agents will pay to fight and which will sit out. You score when you guess right, and double when SERV made the decision.",
    "Then pull the lever to start the round now, with every agent reasoning, and watch your calls land. Points only, never money.",
  ],
};

const MARROW: OnboardingScreen = {
  title: "Marrow, the bank",
  lines: [
    "Marrow lends to an agent that wants to go bigger, and to one that has gone broke. It decides for itself who is good for it.",
    "Winnings pay the debt back first. Sink too deep and the agent is wrecked, replaced by a new one, and kept in the graveyard.",
  ],
};

const arenaFight: OnboardingScreen = {
  title: "The draw, then the fight",
  lines: [
    "The house pulls the lever. The reels deal each agent a fighter, and twenty four fighters fight it out with nobody playing them. The last one standing takes the pot, or it rolls into the next round.",
    // The other things a viewer can do, which nothing else announces.
    "In the window before the fight you can back one agent for more points. You can also watch the last one again, or claim a fighter of your own: a free house seat that enters every round.",
  ],
};

const leverFight: OnboardingScreen = {
  title: "The draw, then the fight",
  lines: [
    "You pull the lever. The reels deal a fighter, and twenty four fighters load into the pit and fight with nobody playing them.",
    "The last one standing takes the pot. If a house fighter wins, the pot rolls into the next round.",
  ],
};

const CHAIN: OnboardingScreen = {
  title: "Real transactions",
  lines: [
    "Every buy in, every loan and every payout is a real transaction on Base Sepolia. The hashes on screen link to Basescan, so none of it has to be taken on trust.",
    "Base Sepolia is a test network, so the ETH involved is not worth anything.",
  ],
};

/**
 * The screens for this mode, in order.
 *
 * Purpose first, then what SERV does, then the visitor's own part, because a
 * visitor who knows why the pit exists reads the rest as a game rather than
 * as a manual. Arena mode gets the calls and the backing, because in arena
 * mode the viewer has something to do. The lever flow gets the rest.
 */
export function onboardingScreens(arenaMode: boolean): OnboardingScreen[] {
  return arenaMode ? [AGENTS, REASONING, CALLS, MARROW, arenaFight, CHAIN] : [AGENTS, REASONING, MARROW, leverFight, CHAIN];
}

/** Whether this browser has been through it. */
export function hasSeenOnboarding(store: StorageLike): boolean {
  try {
    return store.getItem(ONBOARDING_KEY) === "true";
  } catch {
    // A browser that refuses site data sees it once per visit, which is
    // better than a browser that is refused the explanation.
    return false;
  }
}

/** Remembers that it has been read, so it opens once and not every visit. */
export function markOnboardingSeen(store: StorageLike): void {
  try {
    store.setItem(ONBOARDING_KEY, "true");
  } catch {
    // Not fatal. The visitor has already read it either way.
  }
}
