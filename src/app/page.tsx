import { bankEnabled } from "@/config/economy";
import { PlayClient } from "./play/PlayClient";

// Dynamic so the bank flag is read when the page is served rather than baked
// in at build time. The client needs it to know whether there is a graveyard
// to offer; with the flag off it renders exactly what it always did.
export const dynamic = "force-dynamic";

export default function Home() {
  return <PlayClient bankEnabled={bankEnabled()} />;
}
