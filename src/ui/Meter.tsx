"use client";

// A bankroll or a load figure drawn as one of the pack's receptacles rather
// than printed as a number. The fill is the pack's progress sprite clipped to
// a width, so it reads as a gauge filling rather than a coloured div.

import { uiScale } from "./tokens";
import { useUiKit } from "./UiKit";
import styles from "./ui.module.css";

export interface MeterProps {
  /** 0 to 1. Clamped, because a balance can outrun a target. */
  value: number;
  scale?: number;
  /** meterBack plus meterFill, or the mini life bar pair. */
  variant?: "bar" | "mini";
  label?: string;
  className?: string;
}

export function Meter({ value, scale = uiScale, variant = "bar", label, className }: MeterProps) {
  const { ui } = useUiKit();
  const under = ui(variant === "mini" ? "lifeBarUnder" : "meterBack");
  const progress = ui(variant === "mini" ? "lifeBarProgress" : "meterFill");
  const filled = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  return (
    <div
      className={`${styles.meter} ${className ?? ""}`.trim()}
      style={{ width: under.width * scale, height: under.height * scale, backgroundImage: `url(${under.path})`, backgroundSize: "100% 100%" }}
      role="img"
      aria-label={label ?? `${Math.round(filled * 100)} percent`}
    >
      <div
        className={styles.meterFill}
        style={{
          backgroundImage: `url(${progress.path})`,
          backgroundSize: "100% 100%",
          // Clip rather than scale, so the sprite is never stretched thin.
          clipPath: `inset(0 ${(1 - filled) * 100}% 0 0)`,
        }}
      />
    </div>
  );
}
