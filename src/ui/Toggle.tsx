"use client";

// A button that stays down.
//
// The pack's own button sprites, the same four the Button uses, with one
// difference: a chosen toggle is drawn in the pressed sprite and stays in it,
// so a row of them reads as a set of switches rather than a set of actions.
// The label colour follows the sprite for the same reason it does on a
// button: the pressed art is a mid brown and takes the bright bone.

import { animate, createSpring } from "animejs";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ninePatchStyle } from "./ninePatchGeometry";
import { inkFor } from "./surfaces";
import { useUiKit } from "./UiKit";
import styles from "./ui.module.css";

export interface ToggleProps {
  pressed: boolean;
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
  scale?: number;
  className?: string;
  "aria-label"?: string;
}

export function Toggle({ pressed, onPress, disabled = false, children, scale = 2, className, ...rest }: ToggleProps) {
  const { ui } = useUiKit();
  const ref = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);

  const sprite = disabled ? "buttonDisabled" : pressed ? "buttonPressed" : hover ? "buttonHover" : "button";
  const patch = ninePatchStyle(ui(sprite), scale);
  const ink = inkFor(sprite);

  const press = useCallback(() => {
    if (disabled || !ref.current) return;
    // Sprite local scale only, like the button. Nothing moves the page.
    animate(ref.current, { scale: [1, 0.94, 1], ease: createSpring({ stiffness: 180, damping: 12 }) });
  }, [disabled]);

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      className={`${styles.button} ${pressed && !disabled ? styles.toggleOn : ""} ${className ?? ""}`.replace(/\s+/g, " ").trim()}
      style={{ ...patch, color: ink.color }}
      onPointerEnter={() => !disabled && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={press}
      onClick={() => {
        if (disabled) return;
        onPress();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
