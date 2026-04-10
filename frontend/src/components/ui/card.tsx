import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "elevated" | "flat" | "danger" | "success" | "warning";

type CardProps = PropsWithChildren<HTMLAttributes<HTMLDivElement>> & {
  variant?: CardVariant;
  density?: "default" | "compact";
};

const VARIANT_STYLES: Record<CardVariant, { bg: string; border: string }> = {
  default:  { bg: "var(--color-surface)",         border: "var(--color-border)" },
  elevated: { bg: "var(--color-white)",           border: "var(--color-border)" },
  flat:     { bg: "var(--color-ink-05)",          border: "transparent" },
  danger:   { bg: "var(--color-ember-05)",        border: "var(--color-ember-10)" },
  success:  { bg: "var(--color-spruce-05)",       border: "var(--color-spruce-10)" },
  warning:  { bg: "var(--color-amber-10)",        border: "rgba(180,83,9,0.2)" },
};

export function Card({ className, variant = "default", density = "default", style, ...props }: CardProps) {
  const v = VARIANT_STYLES[variant];

  return (
    <div
      className={cn("rounded-xl border", density === "compact" ? "p-4" : "p-5", className)}
      style={{
        background: v.bg,
        borderColor: v.border,
        ...(variant === "elevated" ? { boxShadow: "var(--shadow-md)" } : {}),
        ...style,
      }}
      {...props}
    />
  );
}
