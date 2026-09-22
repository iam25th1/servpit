"use client";

// How it works, once, and then whenever it is asked for.
//
// Over the stage rather than in front of the title, because the first thing a
// visitor should see is the pit, and the second is what they are looking at.
// One card, one screen at a time, and a way out on every one of them: nobody
// is held in a tour they did not ask for.
//
// The motion is a fade and a short rise on the lines, which is the same
// entrance every other panel here uses. Nothing moves the stage, nothing
// scales the viewport, and the card itself does not travel.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { NinePatch } from "@/ui/NinePatch";
import { staggerIn } from "@/ui/transitions";
import { uiScale } from "@/ui/tokens";
import type { OnboardingScreen } from "../onboarding";
import styles from "./onboarding.module.css";

export interface OnboardingProps {
  screens: OnboardingScreen[];
  /** Called when the visitor is done, whether they read it all or skipped. */
  onClose: () => void;
}

export function Onboarding({ screens, onClose }: OnboardingProps) {
  const [at, setAt] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const screen = screens[Math.min(at, screens.length - 1)];
  const last = at >= screens.length - 1;

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    void staggerIn([...card.querySelectorAll<HTMLElement>("[data-onboard-line]")], { delay: 60 });
  }, [at]);

  if (!screen) return null;

  return (
    <div ref={cardRef} className={styles.over} data-anim="onboarding" role="dialog" aria-label="How it works">
      <NinePatch sprite="panelAlt" scale={uiScale} className={styles.card}>
        <p className={styles.step} data-onboard-line="">
          {at + 1} of {screens.length}
        </p>
        <h2 className={styles.title} data-onboard-line="">
          {screen.title}
        </h2>
        {screen.lines.map((line) => (
          <p key={line} className={styles.line} data-onboard-line="">
            {line}
          </p>
        ))}
        <div className={styles.actions} data-onboard-line="">
          <Button onClick={() => setAt((n) => Math.max(0, n - 1))} scale={2} disabled={at === 0}>
            Back
          </Button>
          {last ? (
            <Button onClick={onClose} scale={2}>
              Got it
            </Button>
          ) : (
            <>
              <Button onClick={() => setAt((n) => n + 1)} scale={2}>
                Next
              </Button>
              <Button onClick={onClose} scale={2}>
                Skip
              </Button>
            </>
          )}
        </div>
      </NinePatch>
    </div>
  );
}
