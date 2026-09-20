"use client";

// Button drawn from the pack's own button, hover, pressed and disabled
// sprites, so a state change is a different piece of art rather than a filter.
//
// The press response is a createSpring() animation on this element only. The
// canvas Timeline never touches a DOM node, so the two animation systems
// cannot collide here.

import { animate, createSpring } from "animejs";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { uiScale } from "./tokens";
import { ninePatchStyle } from "./ninePatchGeometry";
import { useUiKit } from "./UiKit";
import styles from "./ui.module.css";

export interface ButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  scale?: number;
  type?: "button" | "submit";
  "aria-pressed"?: boolean;
  "aria-label"?: string;
}

export function Button({ onClick, disabled = false, children, className, scale = uiScale, type = "button", ...rest }: ButtonProps) {
  const { ui } = useUiKit();
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"normal" | "hover" | "pressed">("normal");

  const sprite = disabled ? "buttonDisabled" : state === "pressed" ? "buttonPressed" : state === "hover" ? "buttonHover" : "button";
  const patch = ninePatchStyle(ui(sprite), scale);

  const press = useCallback(() => {
    if (disabled || !ref.current) return;
    // Sprite local scale only. Nothing moves the page.
    animate(ref.current, { scale: [1, 0.94, 1], ease: createSpring({ stiffness: 180, damping: 12 }) });
  }, [disabled]);

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={`${styles.button} ${className ?? ""}`.trim()}
      style={patch}
      onPointerEnter={() => !disabled && setState("hover")}
      onPointerLeave={() => setState("normal")}
      onPointerDown={() => {
        if (disabled) return;
        setState("pressed");
        press();
      }}
      onPointerUp={() => !disabled && setState("hover")}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
