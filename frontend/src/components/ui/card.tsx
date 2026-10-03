import type { HTMLAttributes, PropsWithChildren } from "react";
import { Section as AstryxSection } from "@astryxdesign/core/Section";
import { Card as AstryxCard } from "@astryxdesign/core/Card";
import { cn } from "@/lib/utils";

type SurfaceProps = PropsWithChildren<HTMLAttributes<HTMLDivElement>> & {
  density?: "default" | "compact";
};

type SectionProps = SurfaceProps & {
  variant?: "default" | "danger" | "success" | "warning";
};

export function Section({
  className,
  variant = "default",
  density = "default",
  ...props
}: SectionProps) {
  return (
    <AstryxSection
      variant="transparent"
      padding={0}
      data-tone={variant}
      className={cn(
        "app-section",
        density === "compact" ? "py-4" : "py-5",
        className,
      )}
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
