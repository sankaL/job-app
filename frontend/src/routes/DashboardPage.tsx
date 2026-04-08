import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { listApplications, type ApplicationSummary } from "@/lib/api";
import { visibleStatusLabels } from "@/lib/application-options";

type StatusKey = keyof typeof visibleStatusLabels;

export function DashboardPage() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <div className="page-enter space-y-6">
          <PageHeader title="Dashboard" subtitle="Application analytics and activity overview" />
          <Card variant="danger">
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
      <div className="page-enter space-y-6">
        <PageHeader title="Dashboard" subtitle="Application analytics and activity overview" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="page-enter space-y-6">
        <PageHeader title="Dashboard" subtitle="Application analytics and activity overview" />
        <EmptyState
          title="No applications yet"
          description="Create your first application to start tracking your job search progress and see analytics here."
          action={<Button onClick={() => navigate("/app/applications")}>Go to Applications</Button>}
        />
      </div>
    );
  }

  // ── Compute analytics ──
  const total = applications.length;
  const appliedCount = applications.filter((a) => a.applied).length;
  const needsActionCount = applications.filter((a) => a.visible_status === "needs_action").length;

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

  // Company breakdown
  const companyCounts: Record<string, number> = {};
  for (const app of applications) {
    const company = app.company ?? "Unknown";
    companyCounts[company] = (companyCounts[company] ?? 0) + 1;
  }
  const topCompanies = Object.entries(companyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxCompanyCount = topCompanies[0]?.[1] ?? 1;

  // Monthly breakdown
  const monthlyCounts: Record<string, { created: number; applied: number }> = {};
  for (const app of applications) {
    const d = new Date(app.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthlyCounts[key]) monthlyCounts[key] = { created: 0, applied: 0 };
    monthlyCounts[key].created++;
    if (app.applied) monthlyCounts[key].applied++;
  }
  const monthlyEntries = Object.entries(monthlyCounts).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  const maxMonthly = Math.max(...monthlyEntries.map(([, v]) => v.created), 1);

  // Extraction failures
  const failedExtractions = applications.filter(
    (a) => a.failure_reason === "extraction_failed" || a.internal_state === "manual_entry_required",
  ).length;

  // Recent activity
  const recentApps = [...applications].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5);

  // Origin breakdown
  const originCounts: Record<string, number> = {};
  for (const app of applications) {
    const origin = app.job_posting_origin ?? "Unknown";
    originCounts[origin] = (originCounts[origin] ?? 0) + 1;
  }
  const topOrigins = Object.entries(originCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="page-enter space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Application analytics and activity overview"
        actions={<Button onClick={() => navigate("/app/applications")}>View All Applications</Button>}
      />

      {/* ── Stat Cards ── */}
      <div className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Applications" value={total} />
        <StatCard label="Applied" value={appliedCount} accent="var(--color-spruce)" />
        <StatCard label="Needs Action" value={needsActionCount} accent="var(--color-ember)" />
        <StatCard label="Extraction Failures" value={failedExtractions} accent="var(--color-amber)" />
      </div>

      {/* ── Status Breakdown + Monthly ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Status breakdown */}
        <Card>
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
            Status Breakdown
          </h3>
          <div className="mt-4 space-y-3">
            {(Object.keys(statusCounts) as StatusKey[]).map((status) => (
              <div key={status} className="flex items-center gap-3">
                <StatusBadge status={status} size="sm" />
                <div className="flex-1">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${(statusCounts[status] / total) * 100}%`,
                      minWidth: statusCounts[status] > 0 ? "8px" : "0",
                      background:
                        status === "needs_action" ? "var(--color-ember)" :
                        status === "in_progress" ? "var(--color-spruce)" :
                        status === "complete" ? "var(--color-ink)" :
                        "var(--color-ink-25)",
                    }}
                  />
                </div>
                <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--color-ink)" }}>
                  {statusCounts[status]}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Monthly breakdown */}
        <Card>
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
            Monthly Activity
          </h3>
          <div className="mt-4 flex items-end gap-2" style={{ height: "120px" }}>
            {monthlyEntries.map(([month, counts]) => (
              <div key={month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-col items-center gap-0.5" style={{ height: "96px", justifyContent: "flex-end" }}>
                  <div
                    className="w-full max-w-8 rounded-t transition-all"
                    style={{
                      height: `${(counts.created / maxMonthly) * 100}%`,
                      minHeight: counts.created > 0 ? "4px" : "0",
                      background: "var(--color-ink-10)",
                    }}
                    title={`${counts.created} created`}
                  />
                  <div
                    className="w-full max-w-8 rounded-b transition-all"
                    style={{
                      height: `${(counts.applied / maxMonthly) * 100}%`,
                      minHeight: counts.applied > 0 ? "4px" : "0",
                      background: "var(--color-spruce)",
                    }}
                    title={`${counts.applied} applied`}
                  />
                </div>
                <span className="text-[10px] font-medium" style={{ color: "var(--color-ink-40)" }}>
                  {month.split("-")[1]}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[10px]" style={{ color: "var(--color-ink-40)" }}>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--color-ink-10)" }} />
              Created
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--color-spruce)" }} />
              Applied
            </span>
          </div>
        </Card>
      </div>

      {/* ── Companies + Origins ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top companies */}
        <Card>
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
            Top Companies
          </h3>
          <div className="mt-4 space-y-2">
            {topCompanies.map(([company, count]) => (
              <div key={company} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-ink)" }}>
                  {company}
                </span>
                <div className="w-24">
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      width: `${(count / maxCompanyCount) * 100}%`,
                      background: "var(--color-spruce)",
                    }}
                  />
                </div>
                <span className="w-6 text-right text-xs font-semibold tabular-nums" style={{ color: "var(--color-ink-50)" }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Job sources */}
        <Card>
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
            Job Sources
          </h3>
          <div className="mt-4 space-y-2.5">
            {topOrigins.map(([origin, count]) => (
              <div key={origin} className="flex items-center justify-between">
                <span className="text-sm capitalize" style={{ color: "var(--color-ink)" }}>
                  {origin.replace(/_/g, " ")}
                </span>
                <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--color-ink-50)" }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Recent Activity ── */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
            Recent Activity
          </h3>
          <Button size="sm" variant="secondary" onClick={() => navigate("/app/applications")}>
            View all
          </Button>
        </div>
        <div className="mt-4 divide-y" style={{ borderColor: "var(--color-border)" }}>
          {recentApps.map((app) => (
            <div
              key={app.id}
              className="flex cursor-pointer items-center gap-3 py-3 transition-colors first:pt-0 last:pb-0"
              onClick={() => navigate(`/app/applications/${app.id}`)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-ink-05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <StatusBadge status={app.visible_status} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {app.job_title ?? "Untitled"}
                </div>
                <div className="text-xs" style={{ color: "var(--color-ink-40)" }}>
                  {app.company ?? "Unknown"} · {new Date(app.updated_at).toLocaleDateString()}
                </div>
              </div>
              {app.applied && (
                <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--color-spruce)" }}>
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

/* ── StatCard helper ── */
function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card>
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
        {label}
      </div>
      <div
        className="mt-2 font-display text-3xl font-semibold tabular-nums"
        style={{ color: accent ?? "var(--color-ink)" }}
      >
        {value}
      </div>
    </Card>
  );
}
