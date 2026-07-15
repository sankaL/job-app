import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

type MetricCardProps = {
  icon: LucideIcon;
  label: string;
  value: string | number;
  accent: string;
  tint: string;
  detail?: ReactNode;
};

export function MetricCard({ icon: Icon, label, value, accent, tint, detail }: MetricCardProps) {
  return (
    <Card density="compact" className="relative overflow-hidden">
      <span
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: tint, color: accent }}
      >
        <Icon size={18} />
      </span>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-40)" }}>
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      {detail}
      <div className="mt-3 h-1.5 w-20 rounded-full" style={{ background: tint }}>
        <div className="h-full w-8 rounded-full" style={{ background: accent }} />
      </div>
    </Card>
  );
}
