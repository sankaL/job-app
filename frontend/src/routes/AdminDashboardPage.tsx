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
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import type { AdminOperationMetric } from "@/lib/api";
import { useAdminMetricsQuery } from "@/lib/queries";

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
    <MetricCard
      icon={Icon}
      label={label}
      value={value}
      accent={accent}
      tint={tint}
      detail={
        <p
          className="mt-1 text-xs leading-5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {sublabel}
        </p>
      }
    />
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
  const successRatio =
    metric.total > 0 ? (metric.success_count / metric.total) * 100 : 0;
  const failureRatio =
    metric.total > 0 ? (metric.failure_count / metric.total) * 100 : 0;

  return (
    <Card density="compact" className="relative overflow-hidden">
      <span
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: tint, color: accent }}
      >
        <Icon size={16} />
      </span>

      <p
        className="text-[11px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p
          className="font-display text-2xl font-semibold tabular-nums"
          style={{ color: accent }}
        >
          {formatPercent(metric.success_rate)}
        </p>
        <p
          className="text-xs font-semibold tabular-nums"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {metric.total} total
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span style={{ color: "var(--color-accent)" }}>Success</span>
            <span
              className="tabular-nums"
              style={{ color: "var(--color-accent)" }}
            >
              {metric.success_count}
            </span>
          </div>
          <div
            className="h-2 rounded-full"
            style={{ background: "var(--color-accent-muted)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${successRatio}%`,
                minWidth: metric.success_count > 0 ? "10px" : "0",
                background: "var(--color-accent)",
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span style={{ color: "var(--color-error)" }}>Failure</span>
            <span
              className="tabular-nums"
              style={{ color: "var(--color-error)" }}
            >
              {metric.failure_count}
            </span>
          </div>
          <div
            className="h-2 rounded-full"
            style={{ background: "var(--color-error-muted)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${failureRatio}%`,
                minWidth: metric.failure_count > 0 ? "10px" : "0",
                background: "var(--color-error)",
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function AdminDashboardPage() {
  const { data: metrics, error } = useAdminMetricsQuery();
  const displayedError = error instanceof Error ? error.message : null;

  if (!metrics && !displayedError) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader
          title="Admin Metrics"
          subtitle="Invite and usage funnel performance."
        />
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
        <PageHeader
          title="Admin Metrics"
          subtitle="Invite and usage funnel performance."
        />
        <Card variant="danger" density="compact">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-error)" }}
          >
            Metrics unavailable
          </p>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {displayedError}
          </p>
        </Card>
      </div>
    );
  }

  const inviteAcceptanceRate =
    metrics.invites_sent > 0
      ? (metrics.invites_accepted / metrics.invites_sent) * 100
      : 0;

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Admin Metrics"
        subtitle="Invite and usage funnel performance."
      />

      <div className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Users"
          value={metrics.total_users}
          sublabel={`${metrics.active_users} active · ${metrics.deactivated_users} deactivated`}
          accent="var(--color-text-primary)"
          tint="var(--color-background-muted)"
        />
        <KpiCard
          icon={MailCheck}
          label="Invites"
          value={metrics.invites_sent}
          sublabel={`${formatPercent(inviteAcceptanceRate)} acceptance · ${metrics.invites_pending} pending`}
          accent="var(--color-accent)"
          tint="var(--color-accent-muted)"
        />
        <KpiCard
          icon={FileStack}
          label="Applications"
          value={metrics.total_applications}
          sublabel={`${metrics.invited_users} users still onboarding`}
          accent="var(--color-warning)"
          tint="var(--color-warning-muted)"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Exports"
          value={metrics.export.total}
          sublabel={`${metrics.export.success_count} succeeded`}
          accent="var(--color-accent)"
          tint="var(--color-accent-muted)"
        />
      </div>

      <Card density="compact">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} style={{ color: "var(--color-accent)" }} />
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Workflow outcomes
            </p>
          </div>
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            success vs failure
          </span>
        </div>
        <p
          className="mt-1 text-xs"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Operation outcomes are aggregated from backend usage events.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <OperationCard
            label="Extraction"
            metric={metrics.extraction}
            icon={BarChart3}
            accent="var(--color-accent)"
            tint="var(--color-accent-muted)"
          />
          <OperationCard
            label="Generation"
            metric={metrics.generation}
            icon={Sparkles}
            accent="var(--color-accent)"
            tint="var(--color-accent-muted)"
          />
          <OperationCard
            label="Regeneration"
            metric={metrics.regeneration}
            icon={RotateCcw}
            accent="var(--color-warning)"
            tint="var(--color-warning-muted)"
          />
          <OperationCard
            label="Export"
            metric={metrics.export}
            icon={FileStack}
            accent="var(--color-text-primary)"
            tint="var(--color-background-muted)"
          />
        </div>
      </Card>
    </div>
  );
}
