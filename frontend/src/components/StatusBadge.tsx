import { visibleStatusLabels } from "@/lib/application-options";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: keyof typeof visibleStatusLabels;
  size?: "sm" | "md";
  layout?: "natural" | "rail";
};

const STATUS_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  draft:        { bg: "var(--color-ink-05)",     color: "var(--color-ink-65)", dot: "var(--color-ink-40)" },
  needs_action: { bg: "var(--color-ember-10)",   color: "var(--color-ember)",  dot: "var(--color-ember)" },
  in_progress:  { bg: "var(--color-spruce-10)",  color: "var(--color-spruce)", dot: "var(--color-spruce)" },
  complete:     { bg: "var(--color-ink)",         color: "#fff",               dot: "#fff" },
};

export function StatusBadge({ status, size = "sm", layout = "natural" }: StatusBadgeProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold",
        size === "sm" ? "h-6 px-2.5 text-[11px]" : "h-7 px-3 text-xs",
        layout === "rail" && (size === "sm" ? "min-w-[7.25rem] justify-start" : "min-w-[8rem] justify-start"),
      )}
      style={{ background: s.bg, color: s.color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: s.dot }}
      />
      {visibleStatusLabels[status]}
    </span>
  );
}
