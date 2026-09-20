"use client";

// The pack's dialog frame, used for what it is for: a character saying
// something. The SERV reason strings render here rather than as body text,
// because an agent explaining itself is exactly that.

import { uiScale } from "./tokens";
import { useUiKit } from "./UiKit";
import styles from "./ui.module.css";

export interface DialogProps {
  /** Character id, to draw its faceset in the frame. */
  speaker?: string;
  children: React.ReactNode;
  scale?: number;
  className?: string;
}

export function Dialog({ speaker, children, scale = uiScale, className }: DialogProps) {
  const { ui, facesetPath } = useUiKit();
  const box = ui(speaker ? "dialogFaceset" : "dialogSimple");
  return (
    <div
      className={`${styles.body} ${className ?? ""}`.trim()}
      style={{
        position: "relative",
        backgroundImage: `url(${box.path})`,
        backgroundSize: "100% 100%",
        imageRendering: "pixelated",
        minHeight: box.height * (scale / 2),
        padding: speaker ? `${8 * scale}px ${6 * scale}px ${8 * scale}px ${20 * scale}px` : `${7 * scale}px ${6 * scale}px`,
        fontSize: "var(--text-small)",
      }}
    >
      {speaker && (
        <img
          className={styles.sprite}
          src={facesetPath(speaker)}
          alt=""
          width={38 * (scale / 2)}
          height={38 * (scale / 2)}
          style={{ position: "absolute", left: 3 * scale, top: "50%", transform: "translateY(-50%)" }}
        />
      )}
      {children}
    </div>
  );
}
