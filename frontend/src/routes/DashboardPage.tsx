import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  Globe2,
  Link2,
  Search,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { visibleStatusLabels } from "@/lib/application-options";
import { listApplications, type ApplicationSummary } from "@/lib/api";

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

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTHLY_CHART_CONFIG = {
  created: {
    label: "Created",
    color: "rgba(16, 24, 40, 0.42)",
  },
  createdAndApplied: {
    label: "Created and Marked Applied",
    color: "var(--color-spruce)",
  },
} satisfies ChartConfig;

const STATUS_ACCENTS: Record<StatusKey, { fill: string; track: string }> = {
  draft: { fill: "var(--color-ink-25)", track: "var(--color-ink-10)" },
  needs_action: { fill: "var(--color-ember)", track: "var(--color-ember-10)" },
  in_progress: { fill: "var(--color-spruce)", track: "var(--color-spruce-10)" },
  complete: { fill: "var(--color-ink)", track: "var(--color-ink-10)" },
};

const SOURCE_META: Record<string, { label: string; icon: LucideIcon; accent: string; tint: string }> = {
  linkedin: { label: "LinkedIn", icon: Link2, accent: "#0a66c2", tint: "rgba(10,102,194,0.10)" },
  indeed: { label: "Indeed", icon: Search, accent: "#2557a7", tint: "rgba(37,87,167,0.10)" },
  google_jobs: { label: "Google Jobs", icon: Search, accent: "#1a73e8", tint: "rgba(26,115,232,0.10)" },
  glassdoor: { label: "Glassdoor", icon: Building2, accent: "#0caa41", tint: "rgba(12,170,65,0.10)" },
  ziprecruiter: { label: "ZipRecruiter", icon: TrendingUp, accent: "#1565ff", tint: "rgba(21,101,255,0.10)" },
  monster: { label: "Monster", icon: Globe2, accent: "#6d28d9", tint: "rgba(109,40,217,0.10)" },
  dice: { label: "Dice", icon: Briefcase, accent: "#7c3aed", tint: "rgba(124,58,237,0.10)" },
  company_website: { label: "Company Website", icon: Globe2, accent: "var(--color-spruce)", tint: "var(--color-spruce-10)" },
  unknown: { label: "Unknown", icon: Globe2, accent: "var(--color-ink-50)", tint: "var(--color-ink-05)" },
};
const JOB_SOURCES_CARD_LIMIT = 4;
const OTHER_JOB_SOURCE_META = {
  label: "Other",
  icon: Globe2,
  accent: "var(--color-ink-50)",
  tint: "var(--color-ink-05)",
};

function getCurrentYear() {
  return new Date().getFullYear();
}

function getSourceMeta(origin: string) {
  return SOURCE_META[origin] ?? {
    label: origin.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    icon: Globe2,
    accent: "var(--color-spruce)",
    tint: "var(--color-spruce-10)",
  };
}

function buildMonthlyData(applications: ApplicationSummary[], selectedYear: number): MonthlyDatum[] {
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

function buildDisplayedJobSources(jobSources: SourceDatum[], totalApplications: number): SourceDatum[] {
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

  return [`M ${cx} ${cy}`, `L ${start.x} ${start.y}`, `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`, "Z"].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(() => getCurrentYear());

  async function loadApplications() {
    setError(null);
    try {
      const response = await listApplications();
      setApplications(response);
    } catch (err) {
      setApplications(null);
      setError(err instanceof Error ? err.message : "Unable to load dashboard.");
    }
  }

  useEffect(() => {
    void loadApplications();
  }, []);

  if (applications === null) {
    if (error) {
      return (
        <div className="page-enter space-y-5">
          <PageHeader title="Dashboard" subtitle="Application analytics and activity overview" />
          <Card variant="danger" density="compact">
            <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
              Dashboard unavailable
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
              {error}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void loadApplications()}>Retry</Button>
              <Button variant="secondary" onClick={() => navigate("/app/applications")}>
                Go to Applications
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className="page-enter space-y-5">
        <PageHeader title="Dashboard" subtitle="Application analytics and activity overview" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} density="compact" />)}
        </div>
        <SkeletonCard density="compact" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} density="compact" />)}
        </div>
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader title="Dashboard" subtitle="Application analytics and activity overview" />
        <EmptyState
          title="No applications yet"
          description="Create your first application to start tracking your job search progress and see analytics here."
          action={<Button onClick={() => navigate("/app/applications")}>Go to Applications</Button>}
        />
      </div>
    );
  }

  const total = applications.length;
  const appliedCount = applications.filter((a) => a.applied).length;
  const needsActionCount = applications.filter((a) => a.visible_status === "needs_action").length;
  const failedExtractions = applications.filter(
    (a) => a.failure_reason === "extraction_failed" || a.internal_state === "manual_entry_required",
  ).length;

  const statusCounts: Record<StatusKey, number> = {
    draft: 0,
    needs_action: 0,
    in_progress: 0,
    complete: 0,
  };
  for (const app of applications) {
    if (app.visible_status in statusCounts) {
      statusCounts[app.visible_status as StatusKey]++;
    }
  }

  const companyCounts: Record<string, number> = {};
  for (const app of applications) {
    const company = app.company?.trim() || "Unknown";
    companyCounts[company] = (companyCounts[company] ?? 0) + 1;
  }
  const topCompanies = Object.entries(companyCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxCompanyCount = topCompanies[0]?.[1] ?? 1;

  const availableYears = Array.from(
    new Set([getCurrentYear(), ...applications.map((app) => new Date(app.created_at).getFullYear())]),
  ).sort((a, b) => b - a);

  const monthlyData = buildMonthlyData(applications, selectedYear);
  const totalCreatedForYear = monthlyData.reduce((sum, month) => sum + month.created, 0);
  const totalCreatedAndAppliedForYear = monthlyData.reduce((sum, month) => sum + month.createdAndApplied, 0);

  const originCounts: Record<string, number> = {};
  for (const app of applications) {
    const origin = app.job_posting_origin ?? "unknown";
    originCounts[origin] = (originCounts[origin] ?? 0) + 1;
  }
  const jobSources: SourceDatum[] = Object.entries(originCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([origin, count]) => {
      const meta = getSourceMeta(origin);
      return {
        origin,
        label: meta.label,
        count,
        share: Math.round((count / total) * 100),
        accent: meta.accent,
        tint: meta.tint,
        icon: meta.icon,
      };
    });
  const topJobSources = buildDisplayedJobSources(jobSources, total);

  const recentApps = [...applications]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Application analytics and activity overview"
        actions={<Button onClick={() => navigate("/app/applications")}>View All Applications</Button>}
      />

      <div className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Applications" value={total} accent="var(--color-ink)" tint="var(--color-ink-05)" icon={Briefcase} />
        <StatCard label="Applied" value={appliedCount} accent="var(--color-spruce)" tint="var(--color-spruce-10)" icon={CheckCircle2} />
        <StatCard label="Needs Action" value={needsActionCount} accent="var(--color-ember)" tint="var(--color-ember-10)" icon={AlertTriangle} />
        <StatCard label="Extraction Failures" value={failedExtractions} accent="var(--color-amber)" tint="var(--color-amber-10)" icon={Building2} />
      </div>

      <Card density="compact" className="overflow-hidden !p-0">
        <div
          className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="grid flex-1 gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-40)" }}>
              Monthly Activity
            </h3>
            <p className="text-sm" style={{ color: "var(--color-ink-50)" }}>
              Creation volume and how many of those applications are currently marked applied.
            </p>
          </div>
          <div className="w-full sm:w-40">
            <Select
              id="dashboard-monthly-year"
              aria-label="Select monthly activity year"
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
            >
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="px-2 pb-4 pt-4 sm:px-4 sm:pb-5 sm:pt-5">
          <MonthlyActivityChart data={monthlyData} year={selectedYear} />
        </div>

        <div
          className="flex flex-wrap items-center gap-3 border-t px-4 pb-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] sm:px-6"
          style={{ color: "var(--color-ink-40)", borderColor: "var(--color-border)" }}
        >
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "rgba(16, 24, 40, 0.20)" }} />
            {totalCreatedForYear} created
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "rgba(24, 74, 69, 0.78)" }} />
            {totalCreatedAndAppliedForYear} created + applied
          </span>
          <span>{selectedYear} overview</span>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card density="compact" className="h-full min-h-[198px]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-40)" }}>
              Job Sources
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
              capture mix
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <JobSourcesPieChart sources={topJobSources} />
            <div className="min-w-0 flex-1 space-y-2.5">
              {topJobSources.map((source) => {
                const Icon = source.icon;

                return (
                  <div key={source.origin} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: source.tint, color: source.accent }}
                      >
                        <Icon size={15} />
                      </span>
                      <div className="min-w-0 truncate text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                        {source.label}
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
                          {source.share}%
                        </span>
                      </div>
                    </div>
                    <span className="w-8 text-right text-sm font-semibold tabular-nums" style={{ color: source.accent }}>
                      {source.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card density="compact" className="h-full min-h-[198px]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-40)" }}>
              Top Companies
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
              by volume
            </span>
          </div>
          <div className="mt-4 flex h-[calc(100%-2rem)] flex-col justify-evenly gap-3">
            {topCompanies.map(([company, count]) => (
              <CompactRailRow
                key={company}
                label={
                  <span className="block truncate text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {company}
                  </span>
                }
                value={count}
                maxValue={maxCompanyCount}
                fill="linear-gradient(90deg, var(--color-spruce) 0%, var(--color-spruce-light) 100%)"
                track="var(--color-spruce-10)"
              />
            ))}
          </div>
        </Card>

        <Card density="compact" className="h-full min-h-[198px]">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-40)" }}>
            Status Breakdown
          </h3>
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
        </Card>
      </div>

      <Card density="compact">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-40)" }}>
            Recent Activity
          </h3>
          <Button size="sm" variant="secondary" onClick={() => navigate("/app/applications")}>
            View all
          </Button>
        </div>
        <div className="mt-3 divide-y" style={{ borderColor: "var(--color-border)" }}>
          {recentApps.map((app) => (
            <div
              key={app.id}
              className="flex cursor-pointer items-center gap-3 py-2.5 transition-colors first:pt-0 last:pb-0"
              onClick={() => navigate(`/app/applications/${app.id}`)}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "var(--color-ink-05)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
              }}
            >
              <StatusBadge status={app.visible_status} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {app.job_title ?? "Untitled"}
                </div>
                <div className="truncate text-xs" style={{ color: "var(--color-ink-40)" }}>
                  {app.company ?? "Unknown"} · {new Date(app.updated_at).toLocaleDateString()}
                </div>
              </div>
              {app.applied && (
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "var(--color-spruce)", background: "var(--color-spruce-05)" }}
                >
                  Applied
                </span>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MonthlyActivityChart({ data, year }: { data: MonthlyDatum[]; year: number }) {
  return (
    <ChartContainer
      config={MONTHLY_CHART_CONFIG}
      data-testid="monthly-activity-chart"
      aria-label={`Monthly activity for ${year}`}
      role="img"
      className="h-[320px] w-full"
    >
      <AreaChart data={data} margin={{ left: 6, right: 6, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-created)" stopOpacity={0.46} />
            <stop offset="95%" stopColor="var(--color-created)" stopOpacity={0.06} />
          </linearGradient>
          <linearGradient id="fillApplied" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-applied)" stopOpacity={0.42} />
            <stop offset="95%" stopColor="var(--color-applied)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(16, 24, 40, 0.08)" strokeDasharray="4 8" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={12}
          interval={0}
          tick={{ fill: "rgba(16, 24, 40, 0.44)", fontSize: 11, fontWeight: 700 }}
        />
        <YAxis hide domain={[0, "dataMax + 1"]} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={(value) => `${value} ${year}`} indicator="dot" />}
        />
        <Area
          dataKey="created"
          type="natural"
          fill="url(#fillCreated)"
          stroke="var(--color-created)"
          strokeWidth={3}
          activeDot={{ r: 4, fill: "var(--color-created)" }}
          dot={{ r: 3, fill: "var(--color-created)", strokeWidth: 0 }}
        />
        <Area
          dataKey="createdAndApplied"
          type="natural"
          fill="url(#fillApplied)"
          stroke="var(--color-applied)"
          strokeWidth={3}
          activeDot={{ r: 4, fill: "var(--color-applied)" }}
          dot={{ r: 3, fill: "var(--color-applied)", strokeWidth: 0 }}
        />
      </AreaChart>
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
      <svg aria-label="Job sources pie chart" className="mx-auto h-[176px] w-[176px]" viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={center} cy={center} r={radius + 14} fill="rgba(16, 24, 40, 0.03)" />

        {sources.length === 1 ? (
          <circle cx={center} cy={center} r={radius} fill={sources[0].accent}>
            <title>{`${sources[0].label}: ${sources[0].count} applications (${sources[0].share}%)`}</title>
          </circle>
        ) : (
          sources.map((source) => {
            const sliceAngle = (source.count / total) * 360;
            const endAngle = startAngle + sliceAngle;
            const path = formatPieSlice(center, center, radius, startAngle, endAngle);

            startAngle = endAngle;

            return (
              <path key={source.origin} d={path} fill={source.accent} stroke="rgba(255,255,255,0.88)" strokeWidth="2.5">
                <title>{`${source.label}: ${source.count} applications (${source.share}%)`}</title>
              </path>
            );
          })
        )}

        <circle cx={center} cy={center} r="24" fill="rgba(255,255,255,0.92)" />
        <text x={center} y={center + 3} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--color-ink)">
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
    <div className="flex items-center gap-3">
      <div className="w-[7.5rem] shrink-0 overflow-hidden">
        {label}
      </div>
      <div className="flex-1 overflow-hidden rounded-full" style={{ background: track }}>
        <div
          className="h-2.5 rounded-full transition-all"
          style={{
            width: `${(value / Math.max(maxValue, 1)) * 100}%`,
            minWidth: value > 0 ? "10px" : "0",
            background: fill,
          }}
        />
      </div>
      <span className="w-8 text-right text-sm font-semibold tabular-nums" style={{ color: "var(--color-ink)" }}>
        {value}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  tint,
  icon: Icon,
}: {
  label: string;
  value: number;
  accent: string;
  tint: string;
  icon: LucideIcon;
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
      <div className="mt-3 h-1.5 w-20 rounded-full" style={{ background: tint }}>
        <div className="h-full w-8 rounded-full" style={{ background: accent }} />
      </div>
    </Card>
  );
}
