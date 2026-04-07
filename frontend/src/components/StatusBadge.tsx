import { visibleStatusLabels } from "@/lib/application-options";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: keyof typeof visibleStatusLabels;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]",
        status === "draft" && "bg-black/5 text-ink/70",
        status === "needs_action" && "bg-ember/10 text-ember",
        status === "in_progress" && "bg-spruce/10 text-spruce",
        status === "complete" && "bg-ink text-white",
      )}
    >
      {visibleStatusLabels[status]}
    </span>
  );
}
