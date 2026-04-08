import { visibleStatusLabels } from "@/lib/application-options";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: keyof typeof visibleStatusLabels;
  size?: "sm" | "md";
};

const STATUS_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  draft:        { bg: "var(--color-ink-05)",     color: "var(--color-ink-65)", dot: "var(--color-ink-40)" },
  needs_action: { bg: "var(--color-ember-10)",   color: "var(--color-ember)",  dot: "var(--color-ember)" },
  in_progress:  { bg: "var(--color-spruce-10)",  color: "var(--color-spruce)", dot: "var(--color-spruce)" },
  complete:     { bg: "var(--color-ink)",         color: "#fff",               dot: "#fff" },
};

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        size === "sm" ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
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
