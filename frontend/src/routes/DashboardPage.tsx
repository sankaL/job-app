import { ActionButtons } from "@/components/ui/button-group";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  FileWarning,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";
import { Link, useNavigate } from "react-router-dom";
import {
  CompositionChart,
  PanelGroup,
  Swatch,
  formatShare,
  type CompositionDatum,
} from "@/components/dashboard/Composition";
import { Metric } from "@/components/dashboard/Metric";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonLine, SkeletonSection } from "@/components/ui/skeleton";
import { visibleStatusLabels } from "@/lib/application-options";
import type {
  ApplicationSummary,
  CreationActivity,
  CreationActivityRange,
  SessionBootstrapResponse,
} from "@/lib/api";
import { useApplicationsQuery, useCreationActivityQuery } from "@/lib/queries";

type StatusKey = keyof typeof visibleStatusLabels;

type ActivityDatum = {
  start: string;
  end: string;
  created: number;
  applied: number;
  notApplied: number;
};

const RANGE_OPTIONS: Array<{
  value: CreationActivityRange;
  label: string;
  description: string;
}> = [
  { value: "7d", label: "7D", description: "last 7 days" },
  { value: "30d", label: "30D", description: "last 30 days" },
  { value: "3m", label: "3M", description: "last 3 months" },
  { value: "1y", label: "1Y", description: "last 12 months" },
];

// Two steps of one hue: the stack reads as parts of a single "created" total.
const ACTIVITY_CHART_CONFIG = {
  applied: {
    label: "Marked applied",
    color: "var(--color-data-blue-4)",
  },
  notApplied: {
    label: "Not yet applied",
    color: "var(--color-data-blue-3)",
  },
} satisfies ChartConfig;

const STATUS_COLORS: Record<StatusKey, string> = {
  draft: "var(--color-border-emphasized)",
  needs_action: "var(--color-error)",
  in_progress: "var(--color-icon-blue)",
  complete: "var(--color-success)",
};

// Colors follow the source, never its rank, so filters cannot repaint survivors.
const SOURCE_META: Record<string, { label: string; color: string }> = {
  linkedin: { label: "LinkedIn", color: "var(--color-data-categorical-blue)" },
  company_website: {
    label: "Company Website",
    color: "var(--color-data-categorical-orange)",
  },
  indeed: { label: "Indeed", color: "var(--color-data-categorical-purple)" },
  glassdoor: {
    label: "Glassdoor",
    color: "var(--color-data-categorical-green)",
  },
  google_jobs: {
    label: "Google Jobs",
    color: "var(--color-data-categorical-pink)",
  },
  ziprecruiter: {
    label: "ZipRecruiter",
    color: "var(--color-data-categorical-teal)",
  },
  monster: { label: "Monster", color: "var(--color-data-categorical-brown)" },
  dice: { label: "Dice", color: "var(--color-data-categorical-indigo)" },
  unknown: { label: "Unknown", color: "var(--color-data-neutral)" },
};
const OTHER_SOURCE = {
  key: "other",
  label: "Other",
  color: "var(--color-data-gray-3)",
};
const JOB_SOURCES_LIMIT = 4;
const TOP_COMPANIES_LIMIT = 5;
const RECENT_APPS_LIMIT = 5;

function resolveBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, options).format(
    parseLocalDate(value),
  );
}

function formatBucketLabel(
  datum: Pick<ActivityDatum, "start" | "end">,
  granularity: CreationActivity["granularity"],
) {
  if (granularity === "day") {
    return formatDate(datum.start, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  const start = formatDate(datum.start, { month: "short", day: "numeric" });
  const end = formatDate(datum.end, { month: "short", day: "numeric" });
  return start === end ? `Week of ${start}` : `${start} – ${end}`;
}

function getSourceMeta(origin: string) {
  return (
    SOURCE_META[origin] ?? {
      label: origin
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      color: "var(--color-data-categorical-cyan)",
    }
  );
}

function buildJobSources(applications: ApplicationSummary[]) {
  const counts = new Map<string, number>();
  for (const app of applications) {
    const origin = app.job_posting_origin ?? "unknown";
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  const sources: CompositionDatum[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([origin, count]) => ({
      key: origin,
      count,
      ...getSourceMeta(origin),
    }));
  if (sources.length <= JOB_SOURCES_LIMIT) return sources;

  const visible = sources.slice(0, JOB_SOURCES_LIMIT - 1);
  const otherCount = sources
    .slice(JOB_SOURCES_LIMIT - 1)
    .reduce((sum, source) => sum + source.count, 0);
  return [...visible, { ...OTHER_SOURCE, count: otherCount }];
}

function buildStatusComposition(applications: ApplicationSummary[]) {
  const counts: Record<StatusKey, number> = {
    draft: 0,
    needs_action: 0,
    in_progress: 0,
    complete: 0,
  };
  for (const app of applications)
    if (app.visible_status in counts) counts[app.visible_status as StatusKey]++;
  return (Object.keys(counts) as StatusKey[]).map((status) => ({
    key: status,
    label: visibleStatusLabels[status],
    count: counts[status],
    color: STATUS_COLORS[status],
  }));
}

function buildTopCompanies(applications: ApplicationSummary[]) {
  const counts = new Map<string, number>();
  for (const app of applications) {
    const company = app.company?.trim() || "Unknown";
    counts.set(company, (counts.get(company) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_COMPANIES_LIMIT);
}

function buildDashboardModel(applications: ApplicationSummary[]) {
  const topCompanies = buildTopCompanies(applications);
  return {
    total: applications.length,
    appliedCount: applications.filter((app) => app.applied).length,
    inProgressCount: applications.filter(
      (app) => app.visible_status === "in_progress",
    ).length,
    completeCount: applications.filter(
      (app) => app.visible_status === "complete",
    ).length,
    needsActionCount: applications.filter(
      (app) => app.visible_status === "needs_action",
    ).length,
    failedExtractions: applications.filter(
      (app) =>
        app.failure_reason === "extraction_failed" ||
        app.internal_state === "manual_entry_required",
    ).length,
    statusComposition: buildStatusComposition(applications),
    jobSources: buildJobSources(applications),
    topCompanies,
    recentApps: [...applications]
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .slice(0, RECENT_APPS_LIMIT),
  };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { bootstrap } = useAppContext();
  const [activityRange, setActivityRange] =
    useState<CreationActivityRange>("30d");
  const timezone = useMemo(resolveBrowserTimezone, []);
  const {
    data: applications,
    error: applicationsError,
    refetch,
  } = useApplicationsQuery();
  const activityQuery = useCreationActivityQuery(activityRange, timezone);
  const error =
    applicationsError instanceof Error ? applicationsError.message : null;
  const quota = bootstrap?.generation_quota ?? null;

  if (applications == null) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader
          title="Dashboard"
          subtitle="Application analytics and activity overview"
        />
        {error ? (
          <Section variant="danger" density="compact">
            <VStack gap={1}>
              <Text type="label" style={{ color: "var(--color-error)" }}>
                Dashboard unavailable
              </Text>
              <Text type="body" color="secondary">
                {error}
              </Text>
            </VStack>
            <HStack gap={2} wrap="wrap" className="mt-4">
              <ActionButtons label="Dashboard recovery" size="sm" primaryIndex={0}>
                <Button onClick={() => void refetch()}>Retry</Button>
                <Button
                  variant="secondary"
                  onClick={() => navigate("/app/applications")}
                >
                  Go to Applications
                </Button>
              </ActionButtons>
            </HStack>
          </Section>
        ) : (
          <>
            <Grid columns={{ minWidth: 150, repeat: "fit" }} gap={4}>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonSection key={i} density="compact" />
              ))}
            </Grid>
            <SkeletonSection density="compact" />
            <Grid columns={{ minWidth: 280, repeat: "fit" }} gap={6}>
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonSection key={i} density="compact" />
              ))}
            </Grid>
          </>
        )}
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader
          title="Dashboard"
          subtitle="Application analytics and activity overview"
        />
        <QuotaSummary quota={quota} />
        <EmptyState
          title="No applications yet"
          description="Create your first application to start tracking your job search progress and see analytics here."
          action={
            <Button onClick={() => navigate("/app/applications")}>
              Go to Applications
            </Button>
          }
        />
      </div>
    );
  }

  const model = buildDashboardModel(applications);
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Application analytics and activity overview"
        actions={
          <Button onClick={() => navigate("/app/applications")}>
            View All Applications
          </Button>
        }
      />

      <QuotaSummary quota={quota} />

      <Grid columns={{ minWidth: 150, repeat: "fit" }} gap={4}>
        <Metric
          label="Total applications"
          value={model.total}
          accent="var(--color-text-primary)"
          icon={Briefcase}
          detail={
            <Text type="supporting" color="secondary">
              {model.total > 0
                ? `${model.inProgressCount} in progress · ${model.completeCount} complete`
                : "Add a job posting to start"}
            </Text>
          }
        />
        <Metric
          label="Applied"
          value={model.appliedCount}
          accent="var(--color-text-primary)"
          icon={CheckCircle2}
          detail={
            <Text type="supporting" color="secondary">
              {formatShare(model.appliedCount, model.total)} of applications
            </Text>
          }
        />
        <Metric
          label="Needs action"
          value={model.needsActionCount}
          accent={
            model.needsActionCount > 0
              ? "var(--color-error)"
              : "var(--color-text-primary)"
          }
          icon={AlertTriangle}
          detail={
            <Text type="supporting" color="secondary">
              {model.needsActionCount > 0
                ? "Waiting on your review"
                : "Nothing waiting on you"}
            </Text>
          }
        />
        <Metric
          label="Extraction failures"
          value={model.failedExtractions}
          accent={
            model.failedExtractions > 0
              ? "var(--color-warning)"
              : "var(--color-text-primary)"
          }
          icon={FileWarning}
          detail={
            <Text type="supporting" color="secondary">
              {model.failedExtractions > 0
                ? "Finish with manual entry"
                : "All postings captured"}
            </Text>
          }
        />
      </Grid>

      <CreationActivitySection
        range={activityRange}
        onRangeChange={setActivityRange}
        activity={activityQuery.data}
        isRefreshing={activityQuery.isFetching}
        error={
          activityQuery.error instanceof Error
            ? activityQuery.error.message
            : null
        }
        onRetry={() => void activityQuery.refetch()}
      />

      <PanelGroup
        columns={3}
        panels={[
          {
            key: "sources",
            title: "Job sources",
            content: (
              <CompositionChart
                ariaLabel="Job sources"
                items={model.jobSources}
                total={model.total}
                centerCaption="applications"
              />
            ),
          },
          {
            key: "companies",
            title: "Top companies",
            content: (
              <ol className="divide-y divide-[var(--color-border)]">
                {model.topCompanies.map(([company, count]) => (
                  <li key={company} className="py-2.5 first:pt-0 last:pb-0">
                    <HStack gap={3} vAlign="center">
                      <Avatar
                        name={company}
                        size="sm"
                        shape="rounded"
                        tooltip={false}
                      />
                      <Text type="body" className="min-w-0 flex-1 truncate">
                        {company}
                      </Text>
                      <Text
                        type="supporting"
                        color="secondary"
                        hasTabularNumbers
                      >
                        {formatShare(count, model.total)}
                      </Text>
                      <Text
                        type="label"
                        hasTabularNumbers
                        className="w-6 text-right"
                      >
                        {count}
                      </Text>
                    </HStack>
                  </li>
                ))}
              </ol>
            ),
          },
          {
            key: "status",
            title: "Status breakdown",
            content: (
              <div className="divide-y divide-[var(--color-border)]">
                {model.statusComposition.map((item) => (
                  <HStack
                    key={item.key}
                    gap={3}
                    vAlign="center"
                    className="py-2.5 first:pt-0 last:pb-0"
                    data-testid={`status-figure-${item.key}`}
                  >
                    <div className="min-w-0 flex-1">
                      <StatusBadge status={item.key as StatusKey} size="sm" />
                    </div>
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {formatShare(item.count, model.total)}
                    </Text>
                    <Text
                      type="label"
                      hasTabularNumbers
                      color={item.count > 0 ? "primary" : "secondary"}
                      className="w-6 text-right"
                    >
                      {item.count}
                    </Text>
                  </HStack>
                ))}
              </div>
            ),
          },
        ]}
      />
      <Section density="compact">
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="center">
            <Heading level={3}>Recent activity</Heading>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate("/app/applications")}
            >
              View all
            </Button>
          </HStack>
          <div className="divide-y divide-[var(--color-border)]">
            {model.recentApps.map((app) => (
              <Link
                key={app.id}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-[var(--color-background-muted)] focus-visible:bg-[var(--color-background-muted)]"
                to={`/app/applications/${app.id}`}
              >
                <VStack gap={0} className="min-w-0 flex-1">
                  <Text type="body" weight="medium" className="truncate">
                    {app.job_title ?? "Untitled"}
                  </Text>
                  <Text
                    type="supporting"
                    color="secondary"
                    className="truncate"
                  >
                    {app.company ?? "Unknown"} · Updated{" "}
                    {new Date(app.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </VStack>
                {app.applied && (
                  <HStack gap={1} vAlign="center" className="shrink-0">
                    <CheckCircle2
                      size={14}
                      aria-hidden="true"
                      className="text-[var(--color-success)]"
                    />
                    <Text type="supporting" color="secondary">
                      Applied
                    </Text>
                  </HStack>
                )}
                <StatusBadge
                  status={app.visible_status}
                  size="sm"
                  layout="rail"
                />
              </Link>
            ))}
          </div>
        </VStack>
      </Section>
    </div>
  );
}

function CreationActivitySection({
  range,
  onRangeChange,
  activity,
  isRefreshing,
  error,
  onRetry,
}: {
  range: CreationActivityRange;
  onRangeChange: (range: CreationActivityRange) => void;
  activity: CreationActivity | undefined;
  isRefreshing: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const option =
    RANGE_OPTIONS.find((candidate) => candidate.value === range) ??
    RANGE_OPTIONS[1];
  const unit = range === "1y" ? "week" : "day";

  return (
    <Section density="compact">
      <VStack gap={5}>
        <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Heading level={3}>Activity</Heading>
            <Text type="supporting" color="secondary">
              Applications created per {unit}, {option.description}
            </Text>
          </VStack>
          <SegmentedControl
            label="Activity range"
            value={range}
            size="sm"
            onChange={(value) => onRangeChange(value as CreationActivityRange)}
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

        {activity ? (
          <VStack
            gap={4}
            className={
              isRefreshing
                ? "opacity-50 transition-opacity"
                : "transition-opacity"
            }
            aria-busy={isRefreshing}
          >
            <ActivityChart activity={activity} />
            <HStack gap={4} wrap="wrap">
              {(["applied", "notApplied"] as const).map((key) => (
                <HStack key={key} gap={2} vAlign="center">
                  <Swatch color={ACTIVITY_CHART_CONFIG[key].color} />
                  <Text type="supporting" color="secondary">
                    {ACTIVITY_CHART_CONFIG[key].label}
                  </Text>
                </HStack>
              ))}
            </HStack>
          </VStack>
        ) : !error ? (
          <VStack gap={3} aria-label="Loading activity">
            <SkeletonLine className="w-48" />
            <div className="animate-skeleton h-[240px] rounded-lg" />
          </VStack>
        ) : null}
        {error && (
          <VStack gap={3} hAlign="start">
            <Text type="body" color="secondary">
              {activity
                ? "Activity could not be refreshed. Showing the last loaded activity."
                : "Activity could not be loaded."}{" "}
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

function ActivityChart({ activity }: { activity: CreationActivity }) {
  const data: ActivityDatum[] = activity.buckets.map((bucket) => ({
    start: bucket.start_date,
    end: bucket.end_date,
    created: bucket.created,
    applied: bucket.applied,
    notApplied: Math.max(0, bucket.created - bucket.applied),
  }));
  const tickOptions: Intl.DateTimeFormatOptions =
    activity.range === "7d"
      ? { weekday: "short", day: "numeric" }
      : { month: "short", day: "numeric" };
  const rangeLabel = `${formatDate(activity.start_date, {
    month: "short",
    day: "numeric",
  })} to ${formatDate(activity.end_date, { month: "short", day: "numeric" })}`;

  return (
    <>
      <ChartContainer
        config={ACTIVITY_CHART_CONFIG}
        data-testid="creation-activity-chart"
        data-range={activity.range}
        role="img"
        aria-label={`Applications created per ${activity.granularity}, ${rangeLabel}: ${activity.total_created} created, ${activity.total_applied} marked applied`}
        className="h-[240px]"
      >
        <BarChart
          data={data}
          margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
          barCategoryGap={data.length > 60 ? 1 : "20%"}
        >
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="start"
            tickFormatter={(value: string) => formatDate(value, tickOptions)}
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
            cursor={{ fill: "var(--color-background-muted)" }}
            content={<ActivityTooltip granularity={activity.granularity} />}
          />
          <Bar
            dataKey="applied"
            stackId="created"
            fill="var(--color-applied)"
            maxBarSize={24}
            isAnimationActive={false}
            shape={AppliedSegment}
          />
          <Bar
            dataKey="notApplied"
            stackId="created"
            fill="var(--color-notApplied)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>Applications created per {activity.granularity}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Created</th>
            <th scope="col">Marked applied</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.start}>
              <th scope="row">
                {formatBucketLabel(datum, activity.granularity)}
              </th>
              <td>{datum.created}</td>
              <td>{datum.applied}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// The applied segment sits under "not yet applied": round it only when it is the top of
// the stack, and leave a 2px surface gap when another segment sits on it.
function AppliedSegment(props: BarShapeProps) {
  const datum = props.payload as ActivityDatum | undefined;
  const height = Number(props.height ?? 0);
  if (!datum || height <= 0) return null;
  if (datum.notApplied === 0) {
    return <Rectangle {...props} radius={[4, 4, 0, 0]} />;
  }
  const gap = Math.min(2, height / 2);
  return (
    <Rectangle
      {...props}
      y={Number(props.y ?? 0) + gap}
      height={height - gap}
      radius={0}
    />
  );
}

function ActivityTooltip({
  active,
  payload,
  granularity,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ActivityDatum }>;
  granularity: CreationActivity["granularity"];
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return (
    <Card padding={3} elevation="med">
      <VStack gap={1}>
        <Text type="supporting" color="secondary">
          {formatBucketLabel(datum, granularity)}
        </Text>
        <HStack gap={4} hAlign="between">
          <Text type="supporting">Created</Text>
          <Text type="label" hasTabularNumbers>
            {datum.created}
          </Text>
        </HStack>
        <HStack gap={4} hAlign="between" vAlign="center">
          <HStack gap={2} vAlign="center">
            <Swatch color={ACTIVITY_CHART_CONFIG.applied.color} />
            <Text type="supporting">Marked applied</Text>
          </HStack>
          <Text type="label" hasTabularNumbers>
            {datum.applied}
          </Text>
        </HStack>
      </VStack>
    </Card>
  );
}

type QuotaSummaryProps = {
  quota: SessionBootstrapResponse["generation_quota"] | null;
};

function formatResetDate(value: string | undefined) {
  if (!value) return "next month";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function QuotaSummary({ quota }: QuotaSummaryProps) {
  if (!quota) return null;
  const used = quota.generation_count;
  const limit = quota.monthly_resume_generation_limit;
  const remaining = quota.remaining_count;
  const depleted = remaining <= 0;
  return (
    <Section density="compact">
      <HStack gap={4} vAlign="center" hAlign="between" wrap="wrap">
        <HStack gap={2} vAlign="center">
          <Zap
            size={16}
            aria-hidden="true"
            className="text-[var(--color-text-secondary)]"
          />
          <Text type="body" color="secondary">
            Monthly Requests
          </Text>
          <Text
            type="label"
            color={depleted ? "inherit" : "primary"}
            style={depleted ? { color: "var(--color-error)" } : undefined}
          >
            {remaining} left
          </Text>
        </HStack>
        <VStack gap={1} className="min-w-0 sm:min-w-64">
          <Text type="supporting" color="secondary">
            <span className="capitalize">{quota.subscription_tier} tier</span> ·{" "}
            {used} of {limit} used. Resets {formatResetDate(quota.resets_at)}.
          </Text>
          <ProgressBar
            value={Math.min(used, Math.max(limit, 1))}
            max={Math.max(limit, 1)}
            label="Monthly requests used"
            isLabelHidden
            variant={depleted ? "error" : "accent"}
          />
        </VStack>
      </HStack>
    </Section>
  );
}
