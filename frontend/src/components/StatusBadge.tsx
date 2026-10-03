import { Token } from "@astryxdesign/core/Token";
import { visibleStatusLabels } from "@/lib/application-options";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: keyof typeof visibleStatusLabels;
  size?: "sm" | "md";
  layout?: "natural" | "rail";
};
const colors = {
  draft: "gray",
  needs_action: "red",
  in_progress: "blue",
  complete: "green",
} as const;
export function StatusBadge({
  status,
  size = "sm",
  layout = "natural",
}: StatusBadgeProps) {
  return (
    <Token
      label={visibleStatusLabels[status]}
      color={colors[status]}
      size={size}
      className={cn(
        "shrink-0",
        layout === "rail" &&
          (size === "sm" ? "min-w-[7.25rem]" : "min-w-[8rem]"),
      )}
    />
  );
}
