import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAppContext } from "@/components/layout/AppContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast";
import {
  createApplication,
  listApplications,
  patchApplication,
  type ApplicationSummary,
} from "@/lib/api";

export function ApplicationsListPage() {
  const navigate = useNavigate();
  const { refreshApplications } = useAppContext();
  const { toast } = useToast();
  const [applications, setApplications] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [jobUrl, setJobUrl] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [appliedFilter, setAppliedFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);
  const [confirmAppliedId, setConfirmAppliedId] = useState<string | null>(null);

  useEffect(() => {
    listApplications()
      .then(setApplications)
      .catch((err: Error) => setError(err.message));
  }, []);

  const sourceApplications = applications ?? [];
  const searchTerm = deferredSearch.trim().toLowerCase();
  const filteredApplications = sourceApplications.filter((app) => {
    const matchesSearch =
      !searchTerm ||
      app.job_title?.toLowerCase().includes(searchTerm) ||
      app.company?.toLowerCase().includes(searchTerm);
    const matchesStatus = statusFilter === "all" ? true : app.visible_status === statusFilter;
    const matchesApplied =
      appliedFilter === "all" ? true : appliedFilter === "applied" ? app.applied : !app.applied;
    return matchesSearch && matchesStatus && matchesApplied;
  });

  async function handleCreateApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      const detail = await createApplication(jobUrl);
      refreshApplications();
      toast("Application created successfully");
      navigate(`/app/applications/${detail.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create application.");
      toast(err instanceof Error ? err.message : "Failed to create application", "error");
      setIsCreating(false);
    }
  }

  async function handleAppliedToggle(applicationId: string, applied: boolean) {
    if (!applications) return;
    const previous = applications;
    setApplications(
      applications.map((a) => (a.id === applicationId ? { ...a, applied } : a)),
    );
    try {
      const detail = await patchApplication(applicationId, { applied });
      setApplications(
        previous.map((a) =>
          a.id === applicationId
            ? {
                ...a,
                applied: detail.applied,
                visible_status: detail.visible_status,
                internal_state: detail.internal_state,
                failure_reason: detail.failure_reason,
                updated_at: detail.updated_at,
                has_action_required_notification: detail.has_action_required_notification,
                duplicate_resolution_status: detail.duplicate_resolution_status,
                has_unresolved_duplicate: detail.duplicate_resolution_status === "pending",
              }
            : a,
        ),
      );
      refreshApplications();
      toast(applied ? "Marked as applied" : "Unmarked as applied");
    } catch (err) {
      setApplications(previous);
      setError(err instanceof Error ? err.message : "Unable to update applied state.");
      toast("Failed to update applied status", "error");
    }
  }

  function handleAppliedClick(app: ApplicationSummary, e: React.MouseEvent) {
    e.stopPropagation();
    if (app.applied) {
      // Un-marking doesn't need confirmation
      void handleAppliedToggle(app.id, false);
    } else {
      // Marking as applied needs confirmation
      setConfirmAppliedId(app.id);
    }
  }

  const STATUS_ORDER: Record<string, number> = {
    needs_action: 0,
    in_progress: 1,
    draft: 2,
    complete: 3,
  };

  const columns = [
    {
      key: "status",
      header: "Status",
      width: "120px",
      sortable: true,
      sortValue: (app: ApplicationSummary) => STATUS_ORDER[app.visible_status] ?? 99,
      render: (app: ApplicationSummary) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={app.visible_status} size="sm" />
          {app.has_action_required_notification && (
            <span className="text-[10px] font-semibold" style={{ color: "var(--color-ember)" }}>
              Action Required
            </span>
          )}
        </div>
      ),
    },
    {
      key: "title",
      header: "Job Title",
      sortable: true,
      sortValue: (app: ApplicationSummary) => app.job_title?.toLowerCase() ?? "",
      render: (app: ApplicationSummary) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {app.job_title ?? "Awaiting extraction"}
          </div>
          {app.has_unresolved_duplicate && (
            <span className="text-[10px] font-medium" style={{ color: "var(--color-spruce)" }}>
              Duplicate Review
            </span>
          )}
        </div>
      ),
    },
    {
      key: "company",
      header: "Company",
      sortable: true,
      sortValue: (app: ApplicationSummary) => app.company?.toLowerCase() ?? "zzz",
      render: (app: ApplicationSummary) => (
        <span className="text-sm" style={{ color: "var(--color-ink-65)" }}>
          {app.company ?? "—"}
        </span>
      ),
    },
    {
      key: "resume",
      header: "Base Resume",
      sortable: true,
      sortValue: (app: ApplicationSummary) => app.base_resume_name?.toLowerCase() ?? "zzz",
      render: (app: ApplicationSummary) => (
        <span className="text-xs" style={{ color: "var(--color-ink-40)" }}>
          {app.base_resume_name ?? "—"}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      width: "140px",
      sortable: true,
      sortValue: (app: ApplicationSummary) => new Date(app.updated_at).getTime(),
      render: (app: ApplicationSummary) => (
        <span className="text-xs tabular-nums" style={{ color: "var(--color-ink-40)" }}>
          {new Date(app.updated_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "140px",
      render: (app: ApplicationSummary) => (
        <div onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => handleAppliedClick(app, e)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all"
            style={{
              background: app.applied ? "var(--color-spruce)" : "transparent",
              color: app.applied ? "#fff" : "var(--color-ink-50)",
              border: app.applied ? "1px solid var(--color-spruce)" : "1px solid var(--color-border)",
            }}
            onMouseEnter={(e) => {
              if (!app.applied) {
                e.currentTarget.style.borderColor = "var(--color-spruce)";
                e.currentTarget.style.color = "var(--color-spruce)";
              }
            }}
            onMouseLeave={(e) => {
              if (!app.applied) {
                e.currentTarget.style.borderColor = "var(--color-border)";
                e.currentTarget.style.color = "var(--color-ink-50)";
              }
            }}
          >
            {app.applied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                </svg>
                Applied
              </>
            ) : (
              "Mark Applied"
            )}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Applications"
        subtitle={
          applications !== null
            ? `${applications.length} total · ${applications.filter((a) => a.applied).length} applied`
            : "Loading…"
        }
        actions={
          <Button onClick={() => setShowNewForm(true)}>
            + New Application
          </Button>
        }
      />

      {/* New application form (collapsible) */}
      {showNewForm && (
        <Card variant="elevated" className="animate-scaleIn">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Create New Application
            </h3>
            <button
              onClick={() => setShowNewForm(false)}
              className="text-xs transition-colors"
              style={{ color: "var(--color-ink-40)" }}
            >
              ✕
            </button>
          </div>
          <form className="mt-3 flex gap-3" onSubmit={handleCreateApplication}>
            <Input
              aria-label="Job URL"
              placeholder="Paste a job posting URL"
              type="url"
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
              required
              className="flex-1"
            />
            <Button type="submit" loading={isCreating} disabled={isCreating}>
              {isCreating ? "Creating…" : "Create"}
            </Button>
          </form>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card variant="danger">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
            Request failed
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{error}</p>
        </Card>
      )}

      {/* Filters — aligned inline */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search applications"
          placeholder="Search title or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-36"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="needs_action">Needs Action</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
        </Select>
        <Select
          aria-label="Filter by applied"
          value={appliedFilter}
          onChange={(e) => setAppliedFilter(e.target.value)}
          className="w-32"
        >
          <option value="all">All</option>
          <option value="applied">Applied</option>
          <option value="not_applied">Not Applied</option>
        </Select>
      </div>

      {/* Table / Loading / Empty */}
      {applications === null ? (
        <SkeletonTable rows={8} columns={6} />
      ) : (
        <DataTable
          columns={columns}
          data={filteredApplications}
          getRowKey={(app) => app.id}
          onRowClick={(app) => navigate(`/app/applications/${app.id}`)}
          pageSize={25}
          emptyState={
            <EmptyState
              title={sourceApplications.length === 0 ? "No applications yet" : "No matching applications"}
              description={
                sourceApplications.length === 0
                  ? "Paste a job URL above to create your first application."
                  : "Try adjusting your search or filter criteria."
              }
              action={
                sourceApplications.length === 0 ? (
                  <Button onClick={() => setShowNewForm(true)}>+ New Application</Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {/* Confirmation modal for marking as applied */}
      <ConfirmModal
        open={confirmAppliedId !== null}
        title="Mark as Applied?"
        message="This will mark the application as submitted. You can always change this later."
        confirmLabel="Yes, Mark Applied"
        onConfirm={() => {
          if (confirmAppliedId) {
            void handleAppliedToggle(confirmAppliedId, true);
          }
          setConfirmAppliedId(null);
        }}
        onCancel={() => setConfirmAppliedId(null)}
      />
    </div>
  );
}
