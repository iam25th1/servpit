// The two words beside an agent's verdict, and the rule they follow.
//
// There are three ways an answer can arrive and a viewer is entitled to know
// which one it was. A model answered. Or the pit repeated what a model
// decided in a spot like this one, which is not the same claim. Or the fixed
// rule answered, which says nothing about this pit at all.
//
// A learned line must never read as reasoned. That is the whole point of the
// function existing rather than the comparison being written at the row.

export type LabelTone = "reasoned" | "learned" | "instinct";

export interface SourceLabel {
  text: string;
  tone: LabelTone;
}

/** What to call an answer from this source, or null when there is nothing to say. */
export function sourceLabel(source: string | undefined | null): SourceLabel | null {
  if (!source) return null;
  if (source === "serv") return { text: "reasoned", tone: "reasoned" };
  if (source === "learned") return { text: "learned", tone: "learned" };
  return { text: "on instinct", tone: "instinct" };
}
