// =================================================================
// Button — shared variants (LOOM-281)
// =================================================================

"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

const VARIANT: Record<string, string> = {
  primary: "loom-btn-primary",
  ghost: "loom-btn-ghost border border-loom-border",
  accent:
    "text-2xs py-1 px-2.5 rounded-md border border-loom-accent bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20",
  danger: "text-xs py-1.5 px-3 rounded-md border border-loom-error/40 text-loom-error hover:bg-loom-error/10",
};

const SIZE: Record<string, string> = {
  sm: "text-2xs py-1 px-2",
  md: "text-xs py-1.5 px-3",
  tap: "text-xs min-h-10 py-2 px-3",
};

export type ButtonVariant = keyof typeof VARIANT;
export type ButtonSize = keyof typeof SIZE;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const base = VARIANT[variant] ?? VARIANT.primary;
  const sz = SIZE[size] ?? SIZE.md;
  return (
    <button type={type} className={`${base} ${sz} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
