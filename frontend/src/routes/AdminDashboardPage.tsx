import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Activity, FileStack, MailCheck, Users } from "lucide-react";
import {
  CompositionBar,
  CompositionChart,
  PanelGroup,
  SectionTitle,
  Swatch,
} from "@/components/dashboard/Composition";
import { Metric } from "@/components/dashboard/Metric";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/ui/card";
import { SkeletonSection } from "@/components/ui/skeleton";
import type { AdminMetrics, AdminOperationMetric } from "@/lib/api";
import { useAdminMetricsQuery } from "@/lib/queries";

// Outcome colors are status colors: they carry state, and every value is also labeled.
const OUTCOME_COLORS = {
  success: "var(--color-success)",
  failure: "var(--color-error)",
};

const OPERATIONS: Array<{
  key: keyof Pick<
    AdminMetrics,
    "extraction" | "generation" | "regeneration" | "export"
  >;
  label: string;
}> = [
  { key: "extraction", label: "Extraction" },
  { key: "generation", label: "Generation" },
  { key: "regeneration", label: "Regeneration" },
  { key: "export", label: "Export" },
];

function formatRate(numerator: number, denominator: number) {
  return denominator > 0
    ? `${((numerator / denominator) * 100).toFixed(1)}%`
    : "—";
}

function Detail({ children }: { children: string }) {
  return (
    <Text type="supporting" color="secondary">
      {children}
    </Text>
  );
}

function OperationRow({
  label,
  metric,
}: {
  label: string;
  metric: AdminOperationMetric;
}) {
  const hasRuns = metric.total > 0;
  return (
    <Grid
      columns={{ minWidth: 220, repeat: "fit" }}
      gap={3}
      align="center"
      className="py-3"
      data-testid={`operation-row-${label.toLowerCase()}`}
    >
      <HStack gap={3} hAlign="between" vAlign="center">
        <Text type="body" weight="medium">
          {label}
        </Text>
        <Text type="label" hasTabularNumbers>
          {hasRuns ? formatRate(metric.success_count, metric.total) : "No runs"}
        </Text>
      </HStack>
      <HStack gap={3} vAlign="center">
        <VStack gap={0} className="min-w-0 flex-1">
          <CompositionBar
            ariaLabel={`${label} outcomes`}
            total={metric.total}
            items={[
              {
                key: "success",
                label: "Succeeded",
                count: metric.success_count,
                color: OUTCOME_COLORS.success,
              },
              {
                key: "failure",
                label: "Failed",
                count: metric.failure_count,
                color: OUTCOME_COLORS.failure,
              },
            ]}
          />
        </VStack>
        <Text
          type="supporting"
          color="secondary"
          hasTabularNumbers
          className="w-36 shrink-0 text-right"
        >
          {metric.success_count} ok · {metric.failure_count} failed
        </Text>
      </HStack>
    </Grid>
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
        <Grid columns={{ minWidth: 150, repeat: "fit" }} gap={4}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonSection key={index} density="compact" />
          ))}
        </Grid>
        <Grid columns={{ minWidth: 280, repeat: "fit" }} gap={6}>
          {Array.from({ length: 2 }).map((_, index) => (
            <SkeletonSection key={index} density="compact" />
          ))}
        </Grid>
        <SkeletonSection density="compact" />
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
          <VStack gap={1}>
            <Text type="label" style={{ color: "var(--color-error)" }}>
              Metrics unavailable
            </Text>
            <Text type="body" color="secondary">
              {displayedError}
            </Text>
          </VStack>
        </Section>
      </div>
    );
  }

  const onboardedUsers = Math.max(
    0,
    metrics.active_users - metrics.invited_users,
  );
  const closedInvites = Math.max(
    0,
    metrics.invites_sent - metrics.invites_accepted - metrics.invites_pending,
  );
  const operations = OPERATIONS.map((operation) => ({
    ...operation,
    metric: metrics[operation.key],
  }));
  const totalRuns = operations.reduce((sum, op) => sum + op.metric.total, 0);
  const totalSucceeded = operations.reduce(
    (sum, op) => sum + op.metric.success_count,
    0,
  );
  const totalFailed = operations.reduce(
    (sum, op) => sum + op.metric.failure_count,
    0,
  );

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Admin Metrics"
        subtitle="Invite and usage funnel performance."
      />

      <Grid columns={{ minWidth: 150, repeat: "fit" }} gap={4}>
        <Metric
          icon={Users}
          label="Users"
          value={metrics.total_users}
          accent="var(--color-text-primary)"
          detail={<Detail>{`${metrics.active_users} active`}</Detail>}
        />
        <Metric
          icon={MailCheck}
          label="Invite acceptance"
          value={formatRate(metrics.invites_accepted, metrics.invites_sent)}
          accent="var(--color-text-primary)"
          detail={
            <Detail>{`${metrics.invites_accepted} of ${metrics.invites_sent} invites`}</Detail>
          }
        />
        <Metric
          icon={FileStack}
          label="Applications"
          value={metrics.total_applications}
          accent="var(--color-text-primary)"
          detail={<Detail>Across all users</Detail>}
        />
        <Metric
          icon={Activity}
          label="Workflow success"
          value={formatRate(totalSucceeded, totalRuns)}
          accent="var(--color-text-primary)"
          detail={
            <Detail>{`${totalFailed} failed of ${totalRuns} runs`}</Detail>
          }
        />
      </Grid>

      <PanelGroup
        columns={2}
        panels={[
          {
            key: "users",
            title: "Users",
            content: (
              <CompositionChart
                centerCaption="users"
                ariaLabel="User status"
                total={metrics.total_users}
                items={[
                  {
                    key: "onboarded",
                    label: "Active",
                    count: onboardedUsers,
                    color: "var(--color-success)",
                  },
                  {
                    key: "onboarding",
                    label: "Still onboarding",
                    count: metrics.invited_users,
                    color: "var(--color-icon-blue)",
                  },
                  {
                    key: "deactivated",
                    label: "Deactivated",
                    count: metrics.deactivated_users,
                    color: "var(--color-border-emphasized)",
                  },
                ]}
              />
            ),
          },
          {
            key: "invites",
            title: "Invites",
            content: (
              <CompositionChart
                centerCaption="invites"
                ariaLabel="Invite status"
                total={metrics.invites_sent}
                items={[
                  {
                    key: "accepted",
                    label: "Accepted",
                    count: metrics.invites_accepted,
                    color: "var(--color-success)",
                  },
                  {
                    key: "pending",
                    label: "Pending",
                    count: metrics.invites_pending,
                    color: "var(--color-icon-blue)",
                  },
                  {
                    key: "closed",
                    label: "Expired or revoked",
                    count: closedInvites,
                    color: "var(--color-border-emphasized)",
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Section density="compact">
        <VStack gap={2}>
          <SectionTitle
            title="Workflow outcomes"
            caption={
              <HStack gap={4} wrap="wrap">
                <HStack gap={2} vAlign="center">
                  <Swatch color={OUTCOME_COLORS.success} />
                  <Text type="supporting" color="secondary">
                    Succeeded
                  </Text>
                </HStack>
                <HStack gap={2} vAlign="center">
                  <Swatch color={OUTCOME_COLORS.failure} />
                  <Text type="supporting" color="secondary">
                    Failed
                  </Text>
                </HStack>
              </HStack>
            }
          />
          <Text type="supporting" color="secondary">
            Aggregated from backend usage events.
          </Text>
          <div className="divide-y divide-[var(--color-border)]">
            {operations.map((operation) => (
              <OperationRow
                key={operation.key}
                label={operation.label}
                metric={operation.metric}
              />
            ))}
          </div>
        </VStack>
      </Section>
    </div>
  );
}
