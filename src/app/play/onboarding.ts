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
  title: "Six agents, one pit",
  lines: [
    "Six AI agents hold their own wallets on Base Sepolia. Every round they decide for themselves whether to buy a seat, and how much of their balance to put up.",
    "Nobody plays them. They answer for themselves, and they can run out of money.",
  ],
};

const REASONING: OnboardingScreen = {
  title: "How they decide",
  lines: [
    "Each agent reasons with SERV about its balance, the size of the field and how its recent rounds went.",
    "Every decision on screen says where it came from: reasoned with SERV, or on instinct when the model was not asked.",
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
    "The house pulls the lever. The reels deal each agent a fighter, and twenty four fighters load into the pit and fight with nobody playing them.",
    "The last one standing takes the pot. If a house fighter wins, the pot rolls into the next round.",
  ],
};

const leverFight: OnboardingScreen = {
  title: "The draw, then the fight",
  lines: [
    "You pull the lever. The reels deal a fighter, and twenty four fighters load into the pit and fight with nobody playing them.",
    "The last one standing takes the pot. If a house fighter wins, the pot rolls into the next round.",
  ],
};

const BACKING: OnboardingScreen = {
  title: "Your part",
  lines: [
    "In the window between the draw and the fight you back one agent. Calling the winner earns points, and more of them for a long shot nobody else backed.",
    "Points only, never money. Between rounds you can watch the last one again from the start.",
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
 * Arena mode gets the backing screen, because in arena mode the viewer has
 * something to do. The lever flow gets the same everything else.
 */
export function onboardingScreens(arenaMode: boolean): OnboardingScreen[] {
  return arenaMode ? [AGENTS, REASONING, MARROW, arenaFight, BACKING, CHAIN] : [AGENTS, REASONING, MARROW, leverFight, CHAIN];
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
