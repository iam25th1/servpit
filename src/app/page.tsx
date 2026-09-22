import { arenaMode } from "@/config/arena";
import { bankEnabled } from "@/config/economy";
import { PlayClient } from "./play/PlayClient";

// Dynamic so the flags are read when the page is served rather than baked in
// at build time. The client needs the bank flag to know whether there is a
// graveyard to offer, and the arena flag to know whether it is watching a pit
// that runs itself or driving one with the lever. With both off it renders
// exactly what it always did.
export const dynamic = "force-dynamic";

export default function Home() {
  return <PlayClient bankEnabled={bankEnabled()} arenaMode={arenaMode()} />;
}
