import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CheckCircle2,
  FileStack,
  MailCheck,
  RotateCcw,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import { fetchAdminMetrics, type AdminMetrics, type AdminOperationMetric } from "@/lib/api";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sublabel,
  accent,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sublabel: string;
  accent: string;
  tint: string;
}) {
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
      <p className="mt-1 text-xs leading-5" style={{ color: "var(--color-ink-50)" }}>
        {sublabel}
      </p>
      <div className="mt-3 h-1.5 w-20 rounded-full" style={{ background: tint }}>
        <div className="h-full w-8 rounded-full" style={{ background: accent }} />
      </div>
    </Card>
  );
}

function OperationCard({
  label,
  metric,
  icon: Icon,
  accent,
  tint,
}: {
  label: string;
  metric: AdminOperationMetric;
  icon: LucideIcon;
  accent: string;
  tint: string;
}) {
  const successRatio = metric.total > 0 ? (metric.success_count / metric.total) * 100 : 0;
  const failureRatio = metric.total > 0 ? (metric.failure_count / metric.total) * 100 : 0;

  return (
    <Card density="compact" className="relative overflow-hidden">
      <span
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: tint, color: accent }}
      >
        <Icon size={16} />
      </span>

      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="font-display text-2xl font-semibold tabular-nums" style={{ color: accent }}>
          {formatPercent(metric.success_rate)}
        </p>
        <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--color-ink-50)" }}>
          {metric.total} total
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span style={{ color: "var(--color-spruce)" }}>Success</span>
            <span className="tabular-nums" style={{ color: "var(--color-spruce)" }}>
              {metric.success_count}
            </span>
          </div>
          <div className="h-2 rounded-full" style={{ background: "var(--color-spruce-10)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${successRatio}%`,
                minWidth: metric.success_count > 0 ? "10px" : "0",
                background: "var(--color-spruce)",
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span style={{ color: "var(--color-ember)" }}>Failure</span>
            <span className="tabular-nums" style={{ color: "var(--color-ember)" }}>
              {metric.failure_count}
            </span>
          </div>
          <div className="h-2 rounded-full" style={{ background: "var(--color-ember-10)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${failureRatio}%`,
                minWidth: metric.failure_count > 0 ? "10px" : "0",
                background: "var(--color-ember)",
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMetrics() {
    setError(null);
    try {
      const response = await fetchAdminMetrics();
      setMetrics(response);
    } catch (err) {
      setMetrics(null);
      setError(err instanceof Error ? err.message : "Unable to load admin metrics.");
    }
  }

  useEffect(() => {
    void loadMetrics();
  }, []);

  if (!metrics && !error) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader title="Admin Metrics" subtitle="Invite and usage funnel performance." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} density="compact" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} density="compact" />
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader title="Admin Metrics" subtitle="Invite and usage funnel performance." />
        <Card variant="danger" density="compact">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
            Metrics unavailable
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
            {error}
          </p>
        </Card>
      </div>
    );
  }

  const inviteAcceptanceRate =
    metrics.invites_sent > 0 ? (metrics.invites_accepted / metrics.invites_sent) * 100 : 0;

  return (
    <div className="page-enter space-y-5">
      <PageHeader title="Admin Metrics" subtitle="Invite and usage funnel performance." />

      <div className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Users"
          value={metrics.total_users}
          sublabel={`${metrics.active_users} active · ${metrics.deactivated_users} deactivated`}
          accent="var(--color-ink)"
          tint="var(--color-ink-05)"
        />
        <KpiCard
          icon={MailCheck}
          label="Invites"
          value={metrics.invites_sent}
          sublabel={`${formatPercent(inviteAcceptanceRate)} acceptance · ${metrics.invites_pending} pending`}
          accent="var(--color-spruce)"
          tint="var(--color-spruce-10)"
        />
        <KpiCard
          icon={FileStack}
          label="Applications"
          value={metrics.total_applications}
          sublabel={`${metrics.invited_users} users still onboarding`}
          accent="var(--color-amber)"
          tint="var(--color-amber-10)"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Exports"
          value={metrics.export.total}
          sublabel={`${metrics.export.success_count} succeeded`}
          accent="var(--color-spruce)"
          tint="var(--color-spruce-10)"
        />
      </div>

      <Card density="compact">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} style={{ color: "var(--color-spruce)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Workflow outcomes
            </p>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
            success vs failure
          </span>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--color-ink-50)" }}>
          Operation outcomes are aggregated from backend usage events.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <OperationCard
            label="Extraction"
            metric={metrics.extraction}
            icon={BarChart3}
            accent="var(--color-spruce)"
            tint="var(--color-spruce-10)"
          />
          <OperationCard
            label="Generation"
            metric={metrics.generation}
            icon={Sparkles}
            accent="var(--color-spruce)"
            tint="var(--color-spruce-10)"
          />
          <OperationCard
            label="Regeneration"
            metric={metrics.regeneration}
            icon={RotateCcw}
            accent="var(--color-amber)"
            tint="var(--color-amber-10)"
          />
          <OperationCard
            label="Export"
            metric={metrics.export}
            icon={FileStack}
            accent="var(--color-ink)"
            tint="var(--color-ink-05)"
          />
        </div>
      </Card>
    </div>
  );
}
