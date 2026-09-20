"use client";

// The load bearing component. Every container in the app is one of these, so
// a panel is the pack's carved wood rather than a CSS border.

import type { CSSProperties, ElementType, ReactNode } from "react";
import { uiScale } from "./tokens";
import { ninePatchStyle } from "./ninePatch";
import { useUiKit } from "./UiKit";
import styles from "./ui.module.css";

export interface NinePatchProps {
  /** Manifest id: panel, panelAlt, bg, focus, inventoryCell and so on. */
  sprite?: string;
  scale?: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Applied to the element, for anime.js to target. */
  id?: string;
  "data-anim"?: string;
  role?: string;
  "aria-label"?: string;
}

export function NinePatch({ sprite = "panel", scale = uiScale, as: Tag = "div", className, style, children, ...rest }: NinePatchProps) {
  const { ui } = useUiKit();
  const patch = ninePatchStyle(ui(sprite), scale);
  return (
    <Tag className={`${styles.panel} ${className ?? ""}`.trim()} style={{ ...patch, ...style } as CSSProperties} {...rest}>
      {children}
    </Tag>
  );
}

/** A tighter frame, for grouping rather than containing. */
export function Frame({ sprite = "bg", scale = uiScale, className, style, children, ...rest }: NinePatchProps) {
  const { ui } = useUiKit();
  const patch = ninePatchStyle(ui(sprite), scale);
  return (
    <div className={`${styles.frame} ${className ?? ""}`.trim()} style={{ ...patch, ...style } as CSSProperties} {...rest}>
      {children}
    </div>
  );
}
