import type { HTMLAttributes, PropsWithChildren } from "react";
import { Card as AstryxCard } from "@astryxdesign/core/Card";
import { cn } from "@/lib/utils";

type CardVariant =
  | "default"
  | "elevated"
  | "flat"
  | "danger"
  | "success"
  | "warning";
type CardProps = PropsWithChildren<HTMLAttributes<HTMLDivElement>> & {
  variant?: CardVariant;
  density?: "default" | "compact";
};
const variants = {
  default: "default",
  elevated: "default",
  flat: "muted",
  danger: "red",
  success: "green",
  warning: "yellow",
} as const;
export function Card({
  className,
  variant = "default",
  density = "default",
  ...props
}: CardProps) {
  return (
    <AstryxCard
      padding={density === "compact" ? 4 : 5}
      variant={variants[variant]}
      elevation={variant === "elevated" ? "med" : "none"}
      className={cn("app-card", className)}
      {...props}
    />
  );
}

// Shared visual frame for existing menus and information popovers. Position and content stay with each caller.
export function PopoverSurface({
  className,
  style,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <AstryxCard
      padding={0}
      elevation="high"
      className={cn("app-popover", className)}
      style={{ transformOrigin: "top right", ...style }}
      {...props}
    />
  );
}
