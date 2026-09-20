// What the bankroll meter is a fraction of.
//
// It is the round's swing: each agent's change in balance as a fraction of
// the largest absolute change in the same round. A winner taking 2400 fills
// the bar, an entrant down 100 draws a twenty fourth of it, and an agent that
// held draws nothing.
//
// It used to be the agent's balance as a fraction of the largest balance on
// screen, which cannot discriminate. The agents are funded identically, so at
// a stake of 100 wei against a balance of 999999999999800 wei every bar
// filled to thirteen significant figures of the same number: +0, -100 and
// +2400 all drew a full bar. The absolute balance is not a quantity this
// interface can show usefully; the movement is.

export interface BankrollSwing {
  agentId: string;
  /** Balance after the round minus balance before, so a loss is negative. */
  changeWei: bigint;
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

/** Agent id to a 0..1 meter value, proportional to the change beside it. */
export function swingMeters(swings: readonly BankrollSwing[]): Map<string, number> {
  const out = new Map<string, number>();
  const largest = swings.reduce((max, s) => (abs(s.changeWei) > max ? abs(s.changeWei) : max), 0n);
  for (const s of swings) {
    // Integer maths against a scale of 1000, so a very large swing cannot
    // lose precision through a float before it is divided. Rounded to the
    // nearest thousandth rather than truncated: truncation costs a full step,
    // which on a short bar is a visible pixel.
    out.set(s.agentId, largest === 0n ? 0 : Number((abs(s.changeWei) * 1000n + largest / 2n) / largest) / 1000);
  }
  return out;
}
