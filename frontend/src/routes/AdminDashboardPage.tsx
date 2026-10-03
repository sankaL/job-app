import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
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
import { Metric } from "@/components/dashboard/Metric";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/ui/card";
import { SkeletonSection } from "@/components/ui/skeleton";
import type { AdminOperationMetric } from "@/lib/api";
import { useAdminMetricsQuery } from "@/lib/queries";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function KpiMetric({
  icon: Icon,
  label,
  value,
  sublabel,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sublabel: string;
  accent: string;
}) {
  return (
    <Metric
      icon={Icon}
      label={label}
      value={value}
      accent={accent}
      detail={
        <Text
          as="p"
          display="block"
          type="supporting"
          className="mt-1 leading-5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {sublabel}
        </Text>
      }
    />
  );
}

function OperationMetric({
  label,
  metric,
  icon: Icon,
  accent,
}: {
  label: string;
  metric: AdminOperationMetric;
  icon: LucideIcon;
  accent: string;
}) {
  const successRatio =
    metric.total > 0 ? (metric.success_count / metric.total) * 100 : 0;
  const failureRatio =
    metric.total > 0 ? (metric.failure_count / metric.total) * 100 : 0;

  return (
    <Section density="compact" className="relative overflow-hidden">
      <HStack gap={2} vAlign="center">
        <Icon
          size={16}
          aria-hidden="true"
          className="text-[var(--color-text-secondary)]"
        />
        <Text type="body" color="secondary">
          {label}
        </Text>
      </HStack>
      <div className="mt-2 flex items-end justify-between gap-3">
        <Text
          as="p"
          display="block"
          type="display-3"
          className="tabular-nums"
          style={{ color: accent }}
        >
          {formatPercent(metric.success_rate)}
        </Text>
        <Text
          as="p"
          display="block"
          type="supporting"
          className="tabular-nums"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {metric.total} total
        </Text>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold">
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
          <div className="flex items-center justify-between text-xs font-semibold">
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
    </Section>
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
            <SkeletonSection key={index} density="compact" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonSection key={index} density="compact" />
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
        <Section variant="danger" density="compact">
          <Text
            as="p"
            display="block"
            type="label"
            style={{ color: "var(--color-error)" }}
          >
            Metrics unavailable
          </Text>
          <Text
            as="p"
            display="block"
            type="body"
            className="mt-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {displayedError}
          </Text>
        </Section>
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
        <KpiMetric
          icon={Users}
          label="Users"
          value={metrics.total_users}
          sublabel={`${metrics.active_users} active · ${metrics.deactivated_users} deactivated`}
          accent="var(--color-text-primary)"
        />
        <KpiMetric
          icon={MailCheck}
          label="Invites"
          value={metrics.invites_sent}
          sublabel={`${formatPercent(inviteAcceptanceRate)} acceptance · ${metrics.invites_pending} pending`}
          accent="var(--color-accent)"
        />
        <KpiMetric
          icon={FileStack}
          label="Applications"
          value={metrics.total_applications}
          sublabel={`${metrics.invited_users} users still onboarding`}
          accent="var(--color-warning)"
        />
        <KpiMetric
          icon={CheckCircle2}
          label="Exports"
          value={metrics.export.total}
          sublabel={`${metrics.export.success_count} succeeded`}
          accent="var(--color-accent)"
        />
      </div>

      <Section density="compact">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} style={{ color: "var(--color-accent)" }} />
            <Text
              as="p"
              display="block"
              type="label"
              style={{ color: "var(--color-text-primary)" }}
            >
              Workflow outcomes
            </Text>
          </div>
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--color-text-secondary)" }}
          >
            success vs failure
          </span>
        </div>
        <Text
          as="p"
          display="block"
          type="supporting"
          className="mt-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Operation outcomes are aggregated from backend usage events.
        </Text>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <OperationMetric
            label="Extraction"
            metric={metrics.extraction}
            icon={BarChart3}
            accent="var(--color-accent)"
          />
          <OperationMetric
            label="Generation"
            metric={metrics.generation}
            icon={Sparkles}
            accent="var(--color-accent)"
          />
          <OperationMetric
            label="Regeneration"
            metric={metrics.regeneration}
            icon={RotateCcw}
            accent="var(--color-warning)"
          />
          <OperationMetric
            label="Export"
            metric={metrics.export}
            icon={FileStack}
            accent="var(--color-text-primary)"
          />
        </div>
      </Section>
    </div>
  );
}
