import type { LucideIcon } from "lucide-react";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { Metric } from "@/components/dashboard/Metric";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  Globe2,
  Link2,
  Search,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAppContext } from "@/components/layout/AppContext";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { SkeletonSection } from "@/components/ui/skeleton";
import { visibleStatusLabels } from "@/lib/application-options";
import type { ApplicationSummary, SessionBootstrapResponse } from "@/lib/api";
import { useApplicationsQuery } from "@/lib/queries";

type StatusKey = keyof typeof visibleStatusLabels;

type MonthlyDatum = {
  label: string;
  created: number;
  createdAndApplied: number;
};

type SourceDatum = {
  origin: string;
  label: string;
  count: number;
  share: number;
  accent: string;
  tint: string;
  icon: LucideIcon;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTHLY_CHART_CONFIG = {
  created: {
    label: "Created",
    color: "var(--color-text-secondary)",
  },
  createdAndApplied: {
    label: "Created and Marked Applied",
    color: "var(--color-accent)",
  },
} satisfies ChartConfig;

const STATUS_ACCENTS: Record<StatusKey, { fill: string; track: string }> = {
  draft: {
    fill: "var(--color-border-emphasized)",
    track: "var(--color-neutral)",
  },
  needs_action: {
    fill: "var(--color-error)",
    track: "var(--color-error-muted)",
  },
  in_progress: {
    fill: "var(--color-info)",
    track: "var(--color-info-muted)",
  },
  complete: {
    fill: "var(--color-success)",
    track: "var(--color-success-muted)",
  },
};

const SOURCE_META: Record<
  string,
  { label: string; icon: LucideIcon; accent: string; tint: string }
> = {
  linkedin: {
    label: "LinkedIn",
    icon: Link2,
    accent: "var(--color-data-categorical-blue)",
    tint: "var(--color-border)",
  },
  indeed: {
    label: "Indeed",
    icon: Search,
    accent: "var(--color-data-categorical-indigo)",
    tint: "var(--color-border)",
  },
  google_jobs: {
    label: "Google Jobs",
    icon: Search,
    accent: "var(--color-data-categorical-cyan)",
    tint: "var(--color-border)",
  },
  glassdoor: {
    label: "Glassdoor",
    icon: Building2,
    accent: "var(--color-data-categorical-green)",
    tint: "var(--color-border)",
  },
  ziprecruiter: {
    label: "ZipRecruiter",
    icon: TrendingUp,
    accent: "var(--color-data-categorical-blue)",
    tint: "var(--color-border)",
  },
  monster: {
    label: "Monster",
    icon: Globe2,
    accent: "var(--color-data-categorical-purple)",
    tint: "var(--color-border)",
  },
  dice: {
    label: "Dice",
    icon: Briefcase,
    accent: "var(--color-data-categorical-purple)",
    tint: "var(--color-border)",
  },
  company_website: {
    label: "Company Website",
    icon: Globe2,
    accent: "var(--color-accent)",
    tint: "var(--color-accent-muted)",
  },
  unknown: {
    label: "Unknown",
    icon: Globe2,
    accent: "var(--color-text-secondary)",
    tint: "var(--color-background-muted)",
  },
};
const JOB_SOURCES_CARD_LIMIT = 4;
const OTHER_JOB_SOURCE_META = {
  label: "Other",
  icon: Globe2,
  accent: "var(--color-text-secondary)",
  tint: "var(--color-background-muted)",
};

function getCurrentYear() {
  return new Date().getFullYear();
}

function getSourceMeta(origin: string) {
  return (
    SOURCE_META[origin] ?? {
      label: origin
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      icon: Globe2,
      accent: "var(--color-accent)",
      tint: "var(--color-accent-muted)",
    }
  );
}

function buildMonthlyData(
  applications: ApplicationSummary[],
  selectedYear: number,
): MonthlyDatum[] {
  const monthlyCounts = Array.from({ length: 12 }, (_, monthIndex) => ({
    label: MONTH_LABELS[monthIndex],
    created: 0,
    createdAndApplied: 0,
  }));

  for (const app of applications) {
    const createdDate = new Date(app.created_at);
    if (createdDate.getFullYear() !== selectedYear) continue;

    const monthIndex = createdDate.getMonth();
    monthlyCounts[monthIndex].created++;
    if (app.applied) monthlyCounts[monthIndex].createdAndApplied++;
  }

  return monthlyCounts;
}

function buildDisplayedJobSources(
  jobSources: SourceDatum[],
  totalApplications: number,
): SourceDatum[] {
  if (jobSources.length <= JOB_SOURCES_CARD_LIMIT) {
    return jobSources;
  }

  const visibleSources = jobSources.slice(0, JOB_SOURCES_CARD_LIMIT - 1);
  const otherCount = jobSources
    .slice(JOB_SOURCES_CARD_LIMIT - 1)
    .reduce((sum, source) => sum + source.count, 0);

  return [
    ...visibleSources,
    {
      origin: "other",
      label: OTHER_JOB_SOURCE_META.label,
      count: otherCount,
      share: Math.round((otherCount / totalApplications) * 100),
      accent: OTHER_JOB_SOURCE_META.accent,
      tint: OTHER_JOB_SOURCE_META.tint,
      icon: OTHER_JOB_SOURCE_META.icon,
    },
  ];
}

function formatPieSlice(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function ActivityYearSelect({
  id,
  value,
  years,
  onChange,
}: {
  id: string;
  value: number;
  years: number[];
  onChange: (year: number) => void;
}) {
  return (
    <Select
      id={id}
      aria-label="Select monthly activity year"
      value={String(value)}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {years.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </Select>
  );
}

function buildStatusCounts(applications: ApplicationSummary[]) {
  const counts: Record<StatusKey, number> = {
    draft: 0,
    needs_action: 0,
    in_progress: 0,
    complete: 0,
  };
  for (const app of applications)
    if (app.visible_status in counts) counts[app.visible_status as StatusKey]++;
  return counts;
}

function buildTopCompanies(applications: ApplicationSummary[]) {
  const counts: Record<string, number> = {};
  for (const app of applications) {
    const company = app.company?.trim() || "Unknown";
    counts[company] = (counts[company] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
}

function buildJobSources(applications: ApplicationSummary[]) {
  const counts: Record<string, number> = {};
  for (const app of applications) {
    const origin = app.job_posting_origin ?? "unknown";
    counts[origin] = (counts[origin] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([origin, count]) => ({ origin, count }));
}

function createSourceData(applications: ApplicationSummary[], total: number) {
  return buildJobSources(applications).map(({ origin, count }) => {
    const meta = getSourceMeta(origin);
    return {
      origin,
      count,
      label: meta.label,
      share: Math.round((count / total) * 100),
      accent: meta.accent,
      tint: meta.tint,
      icon: meta.icon,
    };
  });
}

function buildDashboardModel(
  applications: ApplicationSummary[],
  selectedYear: number,
) {
  const total = applications.length;
  const monthlyData = buildMonthlyData(applications, selectedYear);
  const topCompanies = buildTopCompanies(applications);
  return {
    total,
    appliedCount: applications.filter((app) => app.applied).length,
    needsActionCount: applications.filter(
      (app) => app.visible_status === "needs_action",
    ).length,
    failedExtractions: applications.filter(
      (app) =>
        app.failure_reason === "extraction_failed" ||
        app.internal_state === "manual_entry_required",
    ).length,
    statusCounts: buildStatusCounts(applications),
    topCompanies,
    maxCompanyCount: topCompanies[0]?.[1] ?? 1,
    availableYears: Array.from(
      new Set([
        getCurrentYear(),
        ...applications.map((app) => new Date(app.created_at).getFullYear()),
      ]),
    ).sort((a, b) => b - a),
    monthlyData,
    totalCreatedForYear: monthlyData.reduce(
      (sum, month) => sum + month.created,
      0,
    ),
    totalCreatedAndAppliedForYear: monthlyData.reduce(
      (sum, month) => sum + month.createdAndApplied,
      0,
    ),
    topJobSources: buildDisplayedJobSources(
      createSourceData(applications, total),
      total,
    ),
    recentApps: [...applications]
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .slice(0, 5),
  };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { bootstrap } = useAppContext();
  const [selectedYear, setSelectedYear] = useState<number>(() =>
    getCurrentYear(),
  );
  const [chartExpanded, setChartExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768,
  );
  const {
    data: applications,
    error: applicationsError,
    refetch,
  } = useApplicationsQuery();
  const error =
    applicationsError instanceof Error ? applicationsError.message : null;
  const quota = bootstrap?.generation_quota ?? null;

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 768);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (applications == null) {
    if (error) {
      return (
        <div className="page-enter space-y-5">
          <PageHeader
            title="Dashboard"
            subtitle="Application analytics and activity overview"
          />
          <Section variant="danger" density="compact">
            <Text
              as="p"
              display="block"
              type="label"
              style={{ color: "var(--color-error)" }}
            >
              Dashboard unavailable
            </Text>
            <Text
              as="p"
              display="block"
              type="body"
              className="mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {error}
            </Text>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void refetch()}>Retry</Button>
              <Button
                variant="secondary"
                onClick={() => navigate("/app/applications")}
              >
                Go to Applications
              </Button>
            </div>
          </Section>
        </div>
      );
    }

    return (
      <div className="page-enter space-y-5">
        <PageHeader
          title="Dashboard"
          subtitle="Application analytics and activity overview"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonSection key={i} density="compact" />
          ))}
        </div>
        <SkeletonSection density="compact" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonSection key={i} density="compact" />
          ))}
        </div>
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

  const model = buildDashboardModel(applications, selectedYear);
  return (
    <DashboardContent
      model={model}
      quota={quota}
      navigate={navigate}
      selectedYear={selectedYear}
      onYearChange={setSelectedYear}
      isMobile={isMobile}
      chartExpanded={chartExpanded}
      onChartExpandedChange={setChartExpanded}
    />
  );
}

function DashboardContent({
  model,
  quota,
  navigate,
  selectedYear,
  onYearChange,
  isMobile,
  chartExpanded,
  onChartExpandedChange,
}: {
  model: ReturnType<typeof buildDashboardModel>;
  quota: SessionBootstrapResponse["generation_quota"] | null;
  navigate: (path: string) => void;
  selectedYear: number;
  onYearChange: (year: number) => void;
  isMobile: boolean;
  chartExpanded: boolean;
  onChartExpandedChange: (expanded: boolean) => void;
}) {
  const {
    total,
    appliedCount,
    needsActionCount,
    failedExtractions,
    statusCounts,
    topCompanies,
    maxCompanyCount,
    availableYears,
    monthlyData,
    totalCreatedForYear,
    totalCreatedAndAppliedForYear,
    topJobSources,
    recentApps,
  } = model;
  const setSelectedYear = onYearChange;
  const setChartExpanded = onChartExpandedChange;
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

      <div className="stagger-children grid gap-3 grid-cols-2 lg:grid-cols-4 sm:gap-4">
        <Metric
          label="Total Applications"
          value={total}
          accent="var(--color-text-primary)"
          icon={Briefcase}
        />
        <Metric
          label="Applied"
          value={appliedCount}
          accent="var(--color-accent)"
          icon={CheckCircle2}
        />
        <Metric
          label="Needs Action"
          value={needsActionCount}
          accent="var(--color-error)"
          icon={AlertTriangle}
        />
        <Metric
          label="Extraction Failures"
          value={failedExtractions}
          accent="var(--color-warning)"
          icon={Building2}
        />
      </div>

      {/* Monthly Activity — collapsible on mobile */}
      {isMobile ? (
        <div>
          <Button
            variant="ghost"
            type="button"
            className="chart-toggle-btn"
            onClick={() => setChartExpanded(!chartExpanded)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 16h14" />
              <path d="M6 16V9" />
              <path d="M10 16V5" />
              <path d="M14 16v-3" />
            </svg>
            Monthly Activity
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className={`chart-toggle-chevron${chartExpanded ? " open" : ""}`}
            >
              <path
                d="M3.5 5.5l3.5 3.5 3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
          {chartExpanded && (
            <Section density="compact" className="mt-2 overflow-hidden !p-0">
              <div className="px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Heading
                    level={3}
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    Monthly Activity
                  </Heading>
                  <div className="w-28">
                    <ActivityYearSelect
                      id="dashboard-monthly-year-mobile"
                      value={selectedYear}
                      years={availableYears}
                      onChange={setSelectedYear}
                    />
                  </div>
                </div>
              </div>
              <div className="px-1 pb-3">
                <ChartContainer
                  config={MONTHLY_CHART_CONFIG}
                  aria-label={`Monthly activity for ${selectedYear}`}
                  role="img"
                  className="h-[200px] w-full"
                >
                  <BarChart
                    data={monthlyData}
                    margin={{ left: 2, right: 2, top: 8, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--color-border)"
                      strokeDasharray="4 8"
                    />
                    <XAxis
                      dataKey="label"
                      padding={{ left: 12, right: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      interval={1}
                      tick={{
                        fill: "var(--color-text-secondary)",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    />
                    <YAxis hide domain={[0, "dataMax + 1"]} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="created"
                      fill="var(--color-created)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      isAnimationActive={false}
                      dataKey="createdAndApplied"
                      fill="var(--color-applied)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              </div>
              <div
                className="flex flex-wrap items-center gap-2 border-t px-3 pb-3 pt-2 text-xs font-semibold"
                style={{
                  color: "var(--color-text-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: MONTHLY_CHART_CONFIG.created.color }}
                  />
                  {totalCreatedForYear} created
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: MONTHLY_CHART_CONFIG.createdAndApplied.color }}
                  />
                  {totalCreatedAndAppliedForYear} applied
                </span>
              </div>
            </Section>
          )}
        </div>
      ) : (
        <Section density="compact" className="overflow-hidden !p-0">
          <div
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:py-5"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="grid flex-1 gap-1">
              <Heading
                level={3}
                style={{ color: "var(--color-text-secondary)" }}
              >
                Monthly Activity
              </Heading>
              <Text
                as="p"
                display="block"
                type="body"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Creation volume and how many of those applications are currently
                marked applied.
              </Text>
            </div>
            <div className="w-full sm:w-40">
              <ActivityYearSelect
                id="dashboard-monthly-year"
                value={selectedYear}
                years={availableYears}
                onChange={setSelectedYear}
              />
            </div>
          </div>

          <div className="pb-4 pt-4 sm:pb-5 sm:pt-5">
            <MonthlyActivityChart data={monthlyData} year={selectedYear} />
          </div>

          <div
            className="flex flex-wrap items-center gap-3 pb-4 pt-3 text-xs"
            style={{
              color: "var(--color-text-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: MONTHLY_CHART_CONFIG.created.color }}
              />
              {totalCreatedForYear} created
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: MONTHLY_CHART_CONFIG.createdAndApplied.color }}
              />
              {totalCreatedAndAppliedForYear} created + applied
            </span>
            <span>{selectedYear} overview</span>
          </div>
        </Section>
      )}

      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section density="compact" className="h-full min-h-[198px]">
          <div className="flex items-center justify-between gap-3">
            <Heading level={3} style={{ color: "var(--color-text-secondary)" }}>
              Job Sources
            </Heading>
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--color-text-secondary)" }}
            >
              capture mix
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <JobSourcesPieChart sources={topJobSources} />
            <div className="min-w-0 flex-1 space-y-2.5">
              {topJobSources.map((source) => {
                const Icon = source.icon;

                return (
                  <div
                    key={source.origin}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background: source.tint,
                          color: source.accent,
                        }}
                      >
                        <Icon size={15} />
                      </span>
                      <div
                        className="min-w-0 truncate text-sm font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {source.label}
                        <span
                          className="ml-2 text-xs font-semibold"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          {source.share}%
                        </span>
                      </div>
                    </div>
                    <span
                      className="w-8 text-right text-sm font-semibold tabular-nums"
                      style={{ color: source.accent }}
                    >
                      {source.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        <Section density="compact" className="h-full min-h-[198px]">
          <div className="flex items-center justify-between gap-3">
            <Heading level={3} style={{ color: "var(--color-text-secondary)" }}>
              Top Companies
            </Heading>
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--color-text-secondary)" }}
            >
              by volume
            </span>
          </div>
          <div className="mt-4 flex h-[calc(100%-2rem)] flex-col justify-evenly gap-3">
            {topCompanies.map(([company, count]) => (
              <CompactRailRow
                key={company}
                label={
                  <span
                    className="block truncate text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {company}
                  </span>
                }
                value={count}
                maxValue={maxCompanyCount}
                fill="linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent) 100%)"
                track="var(--color-accent-muted)"
              />
            ))}
          </div>
        </Section>

        <Section density="compact" className="h-full min-h-[198px]">
          <Heading level={3} style={{ color: "var(--color-text-secondary)" }}>
            Status Breakdown
          </Heading>
          <div className="mt-4 flex h-[calc(100%-2rem)] flex-col justify-evenly gap-3">
            {(Object.keys(statusCounts) as StatusKey[]).map((status) => (
              <CompactRailRow
                key={status}
                label={<StatusBadge status={status} size="sm" layout="rail" />}
                value={statusCounts[status]}
                maxValue={total}
                fill={STATUS_ACCENTS[status].fill}
                track={STATUS_ACCENTS[status].track}
              />
            ))}
          </div>
        </Section>
      </div>

      <Section density="compact">
        <div className="flex items-center justify-between">
          <Heading level={3} style={{ color: "var(--color-text-secondary)" }}>
            Recent Activity
          </Heading>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate("/app/applications")}
          >
            View all
          </Button>
        </div>
        <div
          className="mt-3 divide-y"
          style={{ borderColor: "var(--color-border)" }}
        >
          {recentApps.map((app) => (
            <Link
              key={app.id}
              className="flex cursor-pointer items-center gap-3 py-2.5 transition-colors first:pt-0 last:pb-0"
              to={`/app/applications/${app.id}`}
              onMouseEnter={(event) => {
                event.currentTarget.style.background =
                  "var(--color-background-muted)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
              }}
            >
              <StatusBadge status={app.visible_status} size="sm" />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {app.job_title ?? "Untitled"}
                </div>
                <div
                  className="truncate text-xs"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {app.company ?? "Unknown"} ·{" "}
                  {new Date(app.updated_at).toLocaleDateString()}
                </div>
              </div>
              {app.applied && (
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{
                    color: "var(--color-accent)",
                    background: "var(--color-accent-muted)",
                  }}
                >
                  Applied
                </span>
              )}
            </Link>
          ))}
        </div>
      </Section>
    </div>
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
  const percent =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
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
        <VStack gap={1} className="min-w-0">
          <Text type="supporting" color="secondary">
            <span className="capitalize">{quota.subscription_tier} tier</span> ·{" "}
            {used} of {limit} used. Resets {formatResetDate(quota.resets_at)}.
          </Text>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--color-background-muted)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${percent}%`,
                background: depleted
                  ? "var(--color-error)"
                  : "var(--color-accent)",
              }}
            />
          </div>
        </VStack>
      </HStack>
    </Section>
  );
}

function MonthlyActivityChart({
  data,
  year,
}: {
  data: MonthlyDatum[];
  year: number;
}) {
  return (
    <ChartContainer
      config={MONTHLY_CHART_CONFIG}
      data-testid="monthly-activity-chart"
      aria-label={`Monthly activity for ${year}`}
      role="img"
      className="h-[260px] w-full"
    >
      <BarChart data={data} margin={{ left: 6, right: 6, top: 8, bottom: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="var(--color-border)"
          strokeDasharray="4 8"
        />
        <XAxis
          dataKey="label"
          padding={{ left: 12, right: 12 }}
          tickLine={false}
          axisLine={false}
          tickMargin={12}
          interval={0}
          tick={{
            fill: "var(--color-text-secondary)",
            fontSize: 12,
            fontWeight: 500,
          }}
        />
        <YAxis hide domain={[0, "dataMax + 1"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => `${value} ${year}`}
              indicator="dot"
            />
          }
        />
        <Bar
          isAnimationActive={false}
          dataKey="created"
          fill="var(--color-created)"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          isAnimationActive={false}
          dataKey="createdAndApplied"
          fill="var(--color-applied)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

function JobSourcesPieChart({ sources }: { sources: SourceDatum[] }) {
  const size = 176;
  const center = size / 2;
  const radius = 54;
  const total = sources.reduce((sum, source) => sum + source.count, 0);
  let startAngle = -90;

  return (
    <div className="mx-auto w-full max-w-[176px] shrink-0 text-center">
      <svg
        aria-label="Job sources pie chart"
        className="mx-auto h-[176px] w-[176px]"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
      >
        <circle
          cx={center}
          cy={center}
          r={radius + 14}
          fill="var(--color-border)"
        />

        {sources.length === 1 ? (
          <circle cx={center} cy={center} r={radius} fill={sources[0].accent}>
            <title>{`${sources[0].label}: ${sources[0].count} applications (${sources[0].share}%)`}</title>
          </circle>
        ) : (
          sources.map((source) => {
            const sliceAngle = (source.count / total) * 360;
            const endAngle = startAngle + sliceAngle;
            const path = formatPieSlice(
              center,
              center,
              radius,
              startAngle,
              endAngle,
            );

            startAngle = endAngle;

            return (
              <path
                key={source.origin}
                d={path}
                fill={source.accent}
                stroke="var(--color-background-surface)"
                strokeWidth="2.5"
              >
                <title>{`${source.label}: ${source.count} applications (${source.share}%)`}</title>
              </path>
            );
          })
        )}

        <circle
          cx={center}
          cy={center}
          r="24"
          fill="var(--color-background-surface)"
        />
        <text
          x={center}
          y={center + 3}
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fill="var(--color-text-primary)"
        >
          {total}
        </text>
      </svg>
    </div>
  );
}

function CompactRailRow({
  label,
  value,
  maxValue,
  fill,
  track,
}: {
  label: ReactNode;
  value: number;
  maxValue: number;
  fill: string;
  track: string;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="w-[5.5rem] sm:w-[7.5rem] shrink-0 overflow-hidden">
        {label}
      </div>
      <div
        className="flex-1 overflow-hidden rounded-full"
        style={{ background: track }}
      >
        <div
          className="h-2.5 rounded-full transition-all"
          style={{
            width: `${(value / Math.max(maxValue, 1)) * 100}%`,
            minWidth: value > 0 ? "10px" : "0",
            background: fill,
          }}
        />
      </div>
      <span
        className="w-8 text-right text-sm font-semibold tabular-nums"
        style={{ color: "var(--color-text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}
