import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Activity, FileStack, MailCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CompositionChart,
  PanelGroup,
  Swatch,
} from "@/components/dashboard/Composition";
import { Metric } from "@/components/dashboard/Metric";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Select } from "@/components/ui/select";
import { SkeletonLine, SkeletonSection } from "@/components/ui/skeleton";
import type {
  WorkflowOperation,
  WorkflowOutcomeCounts,
  WorkflowOutcomeRange,
  WorkflowOutcomes,
} from "@/lib/api";
import { formatLocalDate, resolveBrowserTimezone } from "@/lib/local-dates";
import {
  useAdminMetricsQuery,
  useAdminWorkflowOutcomesQuery,
} from "@/lib/queries";

// Outcome colors are status colors: they carry state, and every value is also labeled.
// Keys avoid the token names so ChartContainer's --color-<key> vars never self-reference.
const OUTCOME_CHART_CONFIG = {
  succeeded: { label: "Succeeded", color: "var(--color-success)" },
  failed: { label: "Failed", color: "var(--color-error)" },
} satisfies ChartConfig;

const WORKFLOW_OPERATIONS: WorkflowOperation[] = [
  "extraction",
  "generation",
  "regeneration",
  "export",
];

const OPERATION_LABELS: Record<WorkflowOperation, string> = {
  extraction: "Extraction",
  generation: "Generation",
  regeneration: "Regeneration",
  export: "Export",
};

type OperationFilter = WorkflowOperation | "all";
type Granularity = WorkflowOutcomes["granularity"];

const RANGE_OPTIONS: Array<{
  value: WorkflowOutcomeRange;
  label: string;
  description: string;
}> = [
  { value: "7d", label: "1W", description: "last 7 days" },
  { value: "30d", label: "1M", description: "last 30 days" },
  { value: "3m", label: "3M", description: "last 3 months" },
  { value: "6m", label: "6M", description: "last 6 months" },
  { value: "1y", label: "1Y", description: "last 12 months" },
  { value: "all", label: "All", description: "all time" },
];
const DEFAULT_RANGE: WorkflowOutcomeRange = "30d";

type OutcomeDatum = {
  start: string;
  end: string;
  succeeded: number;
  failed: number;
};

function formatRate(numerator: number, denominator: number) {
  return denominator > 0
    ? `${((numerator / denominator) * 100).toFixed(1)}%`
    : "—";
}

function sumCounts(counts: WorkflowOutcomeCounts[]) {
  return counts.reduce(
    (sum, count) => ({
      success: sum.success + count.success,
      failure: sum.failure + count.failure,
    }),
    { success: 0, failure: 0 },
  );
}

function selectCounts(
  operations: Record<WorkflowOperation, WorkflowOutcomeCounts>,
  operation: OperationFilter,
) {
  return operation === "all"
    ? sumCounts(WORKFLOW_OPERATIONS.map((key) => operations[key]))
    : operations[operation];
}

function formatBucketLabel(datum: OutcomeDatum, granularity: Granularity) {
  if (granularity === "day") {
    return formatLocalDate(datum.start, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  if (granularity === "month") {
    return formatLocalDate(datum.start, { month: "long", year: "numeric" });
  }
  const start = formatLocalDate(datum.start, {
    month: "short",
    day: "numeric",
  });
  const end = formatLocalDate(datum.end, { month: "short", day: "numeric" });
  return start === end ? `Week of ${start}` : `${start} – ${end}`;
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
  counts,
}: {
  label: string;
  counts: WorkflowOutcomeCounts;
}) {
  const total = counts.success + counts.failure;
  return (
    <HStack
      gap={3}
      hAlign="between"
      vAlign="center"
      className="py-3"
      data-testid={`operation-row-${label.toLowerCase()}`}
    >
      <Text type="body" weight="medium">
        {label}
      </Text>
      <HStack gap={4} vAlign="center">
        <Text type="label" hasTabularNumbers>
          {total > 0 ? formatRate(counts.success, total) : "No runs"}
        </Text>
        <Text
          type="supporting"
          color="secondary"
          hasTabularNumbers
          className="w-28 shrink-0 text-right"
        >
          {counts.success} ok · {counts.failure} failed
        </Text>
      </HStack>
    </HStack>
  );
}

function OutcomeTooltip({
  active,
  payload,
  granularity,
}: {
  active?: boolean;
  payload?: Array<{ payload?: OutcomeDatum }>;
  granularity: Granularity;
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return (
    <Card padding={3} elevation="med">
      <VStack gap={1}>
        <Text type="supporting" color="secondary">
          {formatBucketLabel(datum, granularity)}
        </Text>
        {(["succeeded", "failed"] as const).map((key) => (
          <HStack key={key} gap={4} hAlign="between" vAlign="center">
            <HStack gap={2} vAlign="center">
              <Swatch color={OUTCOME_CHART_CONFIG[key].color} />
              <Text type="supporting">{OUTCOME_CHART_CONFIG[key].label}</Text>
            </HStack>
            <Text type="label" hasTabularNumbers>
              {datum[key]}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Card>
  );
}

function OutcomeChart({
  outcomes,
  operation,
}: {
  outcomes: WorkflowOutcomes;
  operation: OperationFilter;
}) {
  const data: OutcomeDatum[] = outcomes.buckets.map((bucket) => {
    const counts = selectCounts(bucket.operations, operation);
    return {
      start: bucket.start_date,
      end: bucket.end_date,
      succeeded: counts.success,
      failed: counts.failure,
    };
  });
  const tickOptions: Intl.DateTimeFormatOptions =
    outcomes.granularity === "month"
      ? { month: "short", year: "2-digit" }
      : outcomes.range === "7d"
        ? { weekday: "short", day: "numeric" }
        : { month: "short", day: "numeric" };
  const totals = selectCounts(outcomes.totals, operation);
  const scope =
    operation === "all" ? "All operations" : OPERATION_LABELS[operation];

  return (
    <>
      <ChartContainer
        config={OUTCOME_CHART_CONFIG}
        data-testid="workflow-outcomes-chart"
        data-range={outcomes.range}
        data-operation={operation}
        role="img"
        aria-label={`${scope}: succeeded and failed runs per ${outcomes.granularity}, ${totals.success} succeeded, ${totals.failure} failed`}
        className="h-[240px]"
      >
        <LineChart
          data={data}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="start"
            tickFormatter={(value: string) =>
              formatLocalDate(value, tickOptions)
            }
            interval="preserveStartEnd"
            minTickGap={28}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(4, dataMax)]}
            width={28}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-border-emphasized)" }}
            content={<OutcomeTooltip granularity={outcomes.granularity} />}
          />
          {(["succeeded", "failed"] as const).map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={OUTCOME_CHART_CONFIG[key].label}
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <table className="sr-only" data-testid="workflow-outcomes-table">
        <caption>
          {scope}: succeeded and failed runs per {outcomes.granularity}
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Succeeded</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.start}>
              <th scope="row">
                {formatBucketLabel(datum, outcomes.granularity)}
              </th>
              <td>{datum.succeeded}</td>
              <td>{datum.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function WorkflowOutcomesSection({
  range,
  onRangeChange,
  operation,
  onOperationChange,
  outcomes,
  isRefreshing,
  error,
  onRetry,
}: {
  range: WorkflowOutcomeRange;
  onRangeChange: (range: WorkflowOutcomeRange) => void;
  operation: OperationFilter;
  onOperationChange: (operation: OperationFilter) => void;
  outcomes: WorkflowOutcomes | undefined;
  isRefreshing: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  // Describe the data on screen, which stays on the previous range while the next one loads.
  const shownRange = outcomes?.range ?? range;
  const option =
    RANGE_OPTIONS.find((candidate) => candidate.value === shownRange) ??
    RANGE_OPTIONS[1];
  const unit = outcomes?.granularity ?? "day";

  return (
    <Section density="compact">
      <VStack gap={5}>
        <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Heading level={3}>Workflow outcomes</Heading>
            <Text type="supporting" color="secondary">
              Succeeded and failed runs per {unit}, {option.description}
            </Text>
          </VStack>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Select
              aria-label="Workflow operation"
              controlSize="sm"
              className="!w-44"
              value={operation}
              onChange={(event) =>
                onOperationChange(event.target.value as OperationFilter)
              }
            >
              <option value="all">All operations</option>
              {WORKFLOW_OPERATIONS.map((key) => (
                <option key={key} value={key}>
                  {OPERATION_LABELS[key]}
                </option>
              ))}
            </Select>
            <SegmentedControl
              label="Outcome range"
              value={range}
              size="sm"
              onChange={(value) => onRangeChange(value as WorkflowOutcomeRange)}
            >
              {RANGE_OPTIONS.map((candidate) => (
                <SegmentedControlItem
                  key={candidate.value}
                  value={candidate.value}
                  label={candidate.label}
                />
              ))}
            </SegmentedControl>
          </HStack>
        </HStack>

        {outcomes ? (
          <VStack
            gap={4}
            className={
              isRefreshing
                ? "opacity-50 transition-opacity"
                : "transition-opacity"
            }
            aria-busy={isRefreshing}
          >
            <OutcomeChart outcomes={outcomes} operation={operation} />
            <HStack gap={4} wrap="wrap">
              {(["succeeded", "failed"] as const).map((key) => (
                <HStack key={key} gap={2} vAlign="center">
                  <Swatch color={OUTCOME_CHART_CONFIG[key].color} />
                  <Text type="supporting" color="secondary">
                    {OUTCOME_CHART_CONFIG[key].label}
                  </Text>
                </HStack>
              ))}
            </HStack>
            <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {WORKFLOW_OPERATIONS.map((key) => (
                <OperationRow
                  key={key}
                  label={OPERATION_LABELS[key]}
                  counts={outcomes.totals[key]}
                />
              ))}
            </div>
          </VStack>
        ) : !error ? (
          <VStack gap={3} aria-label="Loading workflow outcomes">
            <SkeletonLine className="w-48" />
            <div className="animate-skeleton h-[240px] rounded-lg" />
          </VStack>
        ) : null}
        {error && (
          <VStack gap={3} hAlign="start">
            <Text type="body" color="secondary">
              {outcomes
                ? "Workflow outcomes could not be refreshed. Showing the last loaded range."
                : "Workflow outcomes could not be loaded."}{" "}
              {error}
            </Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={onRetry}
              disabled={isRefreshing}
            >
              Retry
            </Button>
          </VStack>
        )}
      </VStack>
    </Section>
  );
}

export function AdminDashboardPage() {
  const { data: metrics, error } = useAdminMetricsQuery();
  const displayedError = error instanceof Error ? error.message : null;
  const [outcomeRange, setOutcomeRange] =
    useState<WorkflowOutcomeRange>(DEFAULT_RANGE);
  const [operation, setOperation] = useState<OperationFilter>("all");
  const timezone = useMemo(resolveBrowserTimezone, []);
  const outcomesQuery = useAdminWorkflowOutcomesQuery(outcomeRange, timezone);
  // keepPreviousData covers only the pending state. If a range switch fails, the new key has
  // no data, so keep the last loaded range on screen beside the error.
  const [lastOutcomes, setLastOutcomes] = useState<WorkflowOutcomes>();
  if (outcomesQuery.data && outcomesQuery.data !== lastOutcomes) {
    setLastOutcomes(outcomesQuery.data);
  }
  const outcomes = outcomesQuery.data ?? lastOutcomes;
  const outcomesError =
    outcomesQuery.error instanceof Error ? outcomesQuery.error.message : null;

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
  // The tile follows the range of the outcome data it summarizes, which may still be the
  // previous range while the next one loads.
  const outcomeTotals = outcomes
    ? sumCounts(WORKFLOW_OPERATIONS.map((key) => outcomes.totals[key]))
    : null;
  const totalRuns = outcomeTotals
    ? outcomeTotals.success + outcomeTotals.failure
    : 0;
  const shownRange = RANGE_OPTIONS.find(
    (candidate) => candidate.value === outcomes?.range,
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
          value={
            outcomeTotals ? formatRate(outcomeTotals.success, totalRuns) : "—"
          }
          accent="var(--color-text-primary)"
          detail={
            <Detail>
              {outcomeTotals
                ? `${outcomeTotals.failure} failed of ${totalRuns} runs, ${shownRange?.description ?? ""}`
                : outcomesError
                  ? "Unavailable"
                  : "Loading…"}
            </Detail>
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

      <WorkflowOutcomesSection
        range={outcomeRange}
        onRangeChange={setOutcomeRange}
        operation={operation}
        onOperationChange={setOperation}
        outcomes={outcomes}
        isRefreshing={outcomesQuery.isFetching}
        error={outcomesError}
        onRetry={() => void outcomesQuery.refetch()}
      />
    </div>
  );
}
