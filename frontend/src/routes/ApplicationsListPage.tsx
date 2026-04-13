import { useDeferredValue, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CircleStop, Trash2 } from "lucide-react";
import { CreateApplicationModal } from "@/components/applications/CreateApplicationModal";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAppContext } from "@/components/layout/AppContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/StatusBadge";
import { AppliedToggleButton } from "@/components/AppliedToggleButton";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import {
  cancelExtraction,
  createApplication,
  deleteApplication,
  listApplications,
  patchApplication,
  type ApplicationSummary,
} from "@/lib/api";
import { NOTIFICATIONS_CLEARED_EVENT } from "@/lib/events";

const ACTIVE_EXTRACTION_STATES = new Set(["extraction_pending", "extracting"]);
const ACTIVE_DELETE_BLOCKING_STATES = new Set([
  "extraction_pending",
  "extracting",
  "generating",
  "regenerating_full",
  "regenerating_section",
]);
const ACTIVE_NON_EXTRACTION_DELETE_BLOCKING_STATES = new Set(["generating", "regenerating_full", "regenerating_section"]);

function areIdsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatApplicationCount(count: number) {
  return `${count} application${count === 1 ? "" : "s"}`;
}

function getSettledErrorMessage(result: PromiseSettledResult<unknown>) {
  if (result.status !== "rejected") {
    return null;
  }

  return result.reason instanceof Error ? result.reason.message : "Request failed.";
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border"
      style={{ accentColor: "var(--color-spruce)" }}
    />
  );
}

export function ApplicationsListPage() {
  const navigate = useNavigate();
  const { refreshApplications } = useAppContext();
  const { toast } = useToast();
  const [applications, setApplications] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [appliedFilter, setAppliedFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);
  const [confirmAppliedId, setConfirmAppliedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visiblePageIds, setVisiblePageIds] = useState<string[]>([]);
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [rowActionTarget, setRowActionTarget] = useState<{
    mode: "delete" | "cancel_extraction";
    application: ApplicationSummary;
  } | null>(null);
  const [isRowActionSubmitting, setIsRowActionSubmitting] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  async function loadApplications() {
    try {
      const response = await listApplications();
      setApplications(response);
      setError(null);
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load applications.");
      return null;
    }
  }

  useEffect(() => {
    void loadApplications();
  }, []);

  useEffect(() => {
    function handleNotificationsCleared() {
      void loadApplications();
    }

    window.addEventListener(NOTIFICATIONS_CLEARED_EVENT, handleNotificationsCleared);
    return () => window.removeEventListener(NOTIFICATIONS_CLEARED_EVENT, handleNotificationsCleared);
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
  const selectedSet = new Set(selectedIds);
  const selectedApplications = filteredApplications.filter((app) => selectedSet.has(app.id));
  const selectedVisibleCount = visiblePageIds.filter((id) => selectedSet.has(id)).length;
  const allVisibleSelected = visiblePageIds.length > 0 && selectedVisibleCount === visiblePageIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const bulkApplicableIds = selectedApplications.filter((app) => !app.applied).map((app) => app.id);
  const activeSelectedCount = selectedApplications.filter((app) =>
    ACTIVE_DELETE_BLOCKING_STATES.has(app.internal_state),
  ).length;

  useEffect(() => {
    const filteredIds = new Set(filteredApplications.map((app) => app.id));
    setSelectedIds((current) => {
      const next = current.filter((id) => filteredIds.has(id));
      return areIdsEqual(current, next) ? current : next;
    });
  }, [filteredApplications]);

  async function handleCreateApplication(payload: { job_url: string; source_text?: string }) {
    const detail = await createApplication(payload);
    void refreshApplications();
    toast("Application created successfully");
    navigate(`/app/applications/${detail.id}`);
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
      void handleAppliedToggle(app.id, false);
    } else {
      setConfirmAppliedId(app.id);
    }
  }

  function handleVisibleRowsChange(pageRows: ApplicationSummary[]) {
    const nextIds = pageRows.map((row) => row.id);
    setVisiblePageIds((current) => (areIdsEqual(current, nextIds) ? current : nextIds));
  }

  function toggleSelectedId(applicationId: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(applicationId) ? current : [...current, applicationId];
      }
      return current.filter((id) => id !== applicationId);
    });
  }

  function handleSelectVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        visiblePageIds.forEach((id) => next.add(id));
      } else {
        visiblePageIds.forEach((id) => next.delete(id));
      }
      return Array.from(next);
    });
  }

  async function syncApplicationLists() {
    await loadApplications();
    void refreshApplications();
  }

  async function handleBulkMarkApplied() {
    if (bulkApplicableIds.length === 0) {
      toast("All selected applications are already marked as applied.", "info");
      return;
    }

    setIsBulkApplying(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        bulkApplicableIds.map((applicationId) => patchApplication(applicationId, { applied: true })),
      );
      const failedIds = bulkApplicableIds.filter((_, index) => results[index].status === "rejected");
      const successCount = bulkApplicableIds.length - failedIds.length;
      await syncApplicationLists();
      setSelectedIds(failedIds);

      if (failedIds.length === 0) {
        toast(
          `Marked ${formatApplicationCount(successCount)} as applied.`,
        );
        return;
      }

      const firstError = getSettledErrorMessage(results.find((result) => result.status === "rejected") ?? results[0]);
      if (firstError) {
        setError(firstError);
      }
      toast(
        successCount > 0
          ? `Marked ${formatApplicationCount(successCount)} as applied. ${formatApplicationCount(failedIds.length)} failed.`
          : "Failed to mark selected applications as applied.",
        "error",
      );
    } finally {
      setIsBulkApplying(false);
    }
  }

  async function handleBulkDelete() {
    const deleteIds = [...selectedIds];
    if (deleteIds.length === 0) {
      setDeleteConfirmationOpen(false);
      return;
    }

    setIsBulkDeleting(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        deleteIds.map((applicationId) => deleteApplication(applicationId)),
      );
      const failedIds = deleteIds.filter((_, index) => results[index].status === "rejected");
      const successCount = deleteIds.length - failedIds.length;
      await syncApplicationLists();
      setSelectedIds(failedIds);
      setDeleteConfirmationOpen(false);

      if (failedIds.length === 0) {
        toast(`Deleted ${formatApplicationCount(successCount)}.`);
        return;
      }

      const firstError = getSettledErrorMessage(results.find((result) => result.status === "rejected") ?? results[0]);
      if (firstError) {
        setError(firstError);
      }
      toast(
        successCount > 0
          ? `Deleted ${formatApplicationCount(successCount)}. ${formatApplicationCount(failedIds.length)} failed.`
          : "Failed to delete selected applications.",
        "error",
      );
    } finally {
      setIsBulkDeleting(false);
    }
  }

  async function handleRowActionConfirm() {
    if (!rowActionTarget) return;

    setIsRowActionSubmitting(true);
    setError(null);
    try {
      if (rowActionTarget.mode === "delete") {
        await deleteApplication(rowActionTarget.application.id);
        await syncApplicationLists();
        toast("Application deleted.");
      } else {
        await cancelExtraction(rowActionTarget.application.id);
        await syncApplicationLists();
        toast("Extraction stopped.");
      }
      setRowActionTarget(null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : rowActionTarget.mode === "delete"
            ? "Unable to delete application."
            : "Unable to stop extraction.";
      setError(message);
      toast(rowActionTarget.mode === "delete" ? "Failed to delete application" : "Failed to stop extraction", "error");
    } finally {
      setIsRowActionSubmitting(false);
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
      key: "select",
      header: (
        <div className="flex items-start">
          <SelectionCheckbox
            checked={allVisibleSelected}
            indeterminate={someVisibleSelected}
            disabled={visiblePageIds.length === 0}
            ariaLabel="Select current page"
            onChange={(event) => handleSelectVisible(event.target.checked)}
          />
        </div>
      ),
      width: "56px",
      hiddenOnMobile: true,
      render: (app: ApplicationSummary) => (
        <div className="flex items-start" onClick={(event) => event.stopPropagation()}>
          <SelectionCheckbox
            checked={selectedSet.has(app.id)}
            ariaLabel={`Select ${app.job_title ?? app.company ?? "application"}`}
            onChange={(event) => toggleSelectedId(app.id, event.target.checked)}
          />
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "132px",
      sortable: true,
      sortValue: (app: ApplicationSummary) => STATUS_ORDER[app.visible_status] ?? 99,
      render: (app: ApplicationSummary) => (
        <div className="flex items-start">
          <StatusBadge status={app.visible_status} size="sm" layout="rail" />
        </div>
      ),
    },
    {
      key: "title",
      header: "Job Title",
      sortable: true,
      width: "minmax(200px, 1fr)",
      sortValue: (app: ApplicationSummary) => app.job_title?.toLowerCase() ?? "",
      render: (app: ApplicationSummary) => (
        <div className="flex min-w-0 flex-col justify-center">
          <div className="truncate whitespace-nowrap text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {app.job_title ?? "Awaiting extraction"}
          </div>
          {(app.has_action_required_notification && app.visible_status !== "needs_action") || app.has_unresolved_duplicate ? (
            <div
              className="truncate text-[10px] font-medium leading-[1.2]"
              style={{
                color:
                  app.has_action_required_notification && app.visible_status !== "needs_action"
                    ? "var(--color-ember)"
                    : app.has_unresolved_duplicate
                      ? "var(--color-spruce)"
                      : "var(--color-ink-25)",
              }}
            >
              {app.has_action_required_notification && app.visible_status !== "needs_action"
                ? "Action required"
                : "Duplicate review pending"}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "company",
      header: "Company",
      width: "180px",
      sortable: true,
      sortValue: (app: ApplicationSummary) => app.company?.toLowerCase() ?? "zzz",
      render: (app: ApplicationSummary) => (
        <span className="block truncate text-sm" style={{ color: "var(--color-ink-65)" }}>
          {app.company ?? "—"}
        </span>
      ),
    },
    {
      key: "resume",
      header: "Base Resume",
      width: "180px",
      sortable: true,
      hiddenOnMobile: true,
      sortValue: (app: ApplicationSummary) => app.base_resume_name?.toLowerCase() ?? "zzz",
      render: (app: ApplicationSummary) => (
        <span className="block truncate text-xs" style={{ color: "var(--color-ink-40)" }}>
          {app.base_resume_name ?? "—"}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      width: "118px",
      sortable: true,
      hiddenOnMobile: true,
      sortValue: (app: ApplicationSummary) => new Date(app.updated_at).getTime(),
      render: (app: ApplicationSummary) => (
        <span className="block text-xs tabular-nums" style={{ color: "var(--color-ink-40)" }}>
          {new Date(app.updated_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "196px",
      hiddenOnMobile: true,
      render: (app: ApplicationSummary) => (
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <AppliedToggleButton applied={app.applied} compact onClick={(e) => handleAppliedClick(app, e)} />
          {ACTIVE_EXTRACTION_STATES.has(app.internal_state) ? (
            <IconButton
              variant="danger"
              aria-label={`Stop extraction for ${app.job_title ?? app.company ?? "application"}`}
              title="Stop extraction"
              onClick={() => setRowActionTarget({ mode: "cancel_extraction", application: app })}
            >
              <CircleStop size={16} aria-hidden="true" />
            </IconButton>
          ) : (
            <IconButton
              variant="danger"
              aria-label={
                ACTIVE_NON_EXTRACTION_DELETE_BLOCKING_STATES.has(app.internal_state)
                  ? `Delete unavailable while ${app.job_title ?? app.company ?? "application"} is still processing`
                  : `Delete ${app.job_title ?? app.company ?? "application"}`
              }
              title={
                ACTIVE_NON_EXTRACTION_DELETE_BLOCKING_STATES.has(app.internal_state)
                  ? "Delete unavailable while background work is still running."
                  : "Delete application"
              }
              disabled={ACTIVE_NON_EXTRACTION_DELETE_BLOCKING_STATES.has(app.internal_state)}
              onClick={() => setRowActionTarget({ mode: "delete", application: app })}
            >
              <Trash2 size={16} aria-hidden="true" />
            </IconButton>
          )}
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
          <Button onClick={() => setShowCreateModal(true)}>
            + New Application
          </Button>
        }
      />

      {error && (
        <Card variant="danger" density="compact">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
            Request failed
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{error}</p>
        </Card>
      )}

      {/* Desktop filters */}
      <div className="hidden gap-3 md:grid md:grid-cols-[minmax(0,1.8fr)_minmax(180px,0.8fr)_minmax(160px,0.7fr)] xl:grid-cols-[minmax(320px,2.2fr)_240px_220px]">
        <Input
          aria-label="Search applications"
          placeholder="Search title or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
        />
        <Select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full"
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
          className="w-full"
        >
          <option value="all">All</option>
          <option value="applied">Applied</option>
          <option value="not_applied">Not Applied</option>
        </Select>
      </div>

      {/* Mobile filters */}
      <div className="flex flex-col gap-2 md:hidden">
        <div className="flex gap-2">
          <Input
            aria-label="Search applications"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <button
            type="button"
            className="mobile-filters-toggle"
            onClick={() => setShowMobileFilters(!showMobileFilters)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M4 8h8M6 12h4" />
            </svg>
            Filters
          </button>
        </div>
        {showMobileFilters && (
          <div className="flex gap-2">
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1"
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
              className="flex-1"
            >
              <option value="all">All</option>
              <option value="applied">Applied</option>
              <option value="not_applied">Not Applied</option>
            </Select>
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <Card variant="default" density="compact">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                {`${formatApplicationCount(selectedIds.length)} selected`}
              </p>
              {activeSelectedCount > 0 && (
                <p className="text-xs" style={{ color: "var(--color-ember)" }}>
                  {activeSelectedCount === 1
                    ? "Delete is unavailable while 1 selected application is still processing."
                    : `Delete is unavailable while ${activeSelectedCount} selected applications are still processing.`}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleBulkMarkApplied()}
                loading={isBulkApplying}
                disabled={isBulkApplying || isBulkDeleting}
              >
                Mark Applied
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteConfirmationOpen(true)}
                disabled={isBulkApplying || isBulkDeleting || activeSelectedCount > 0}
              >
                Delete
              </Button>
            </div>
          </div>
        </Card>
      )}

      {applications === null ? (
        <SkeletonTable rows={8} columns={7} />
      ) : (
        <DataTable
          columns={columns}
          data={filteredApplications}
          getRowKey={(app) => app.id}
          onRowClick={(app) => navigate(`/app/applications/${app.id}`)}
          pageSize={25}
          density="compact"
          tableLayout="fixed"
          verticalAlign="middle"
          onVisibleRowsChange={handleVisibleRowsChange}
          emptyState={
            <EmptyState
              title={sourceApplications.length === 0 ? "No applications yet" : "No matching applications"}
              description={
                sourceApplications.length === 0
                  ? "Open the new application modal to create your first application from a job link."
                  : "Try adjusting your search or filter criteria."
              }
              action={
                sourceApplications.length === 0 ? (
                  <Button onClick={() => setShowCreateModal(true)}>+ New Application</Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <CreateApplicationModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateApplication}
      />

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

      <ConfirmModal
        open={deleteConfirmationOpen}
        title={selectedIds.length === 1 ? "Delete application?" : "Delete applications?"}
        message={
          selectedIds.length === 1
            ? "This will permanently remove the selected application and its current draft. This action cannot be undone."
            : `This will permanently remove ${selectedIds.length} selected applications and their current drafts. This action cannot be undone.`
        }
        confirmLabel={selectedIds.length === 1 ? "Delete Application" : "Delete Applications"}
        variant="danger"
        loading={isBulkDeleting}
        onConfirm={() => {
          void handleBulkDelete();
        }}
        onCancel={() => {
          if (!isBulkDeleting) {
            setDeleteConfirmationOpen(false);
          }
        }}
      />

      <ConfirmModal
        open={rowActionTarget !== null}
        title={rowActionTarget?.mode === "cancel_extraction" ? "Stop extraction?" : "Delete application?"}
        message={
          rowActionTarget?.mode === "cancel_extraction"
            ? "This will stop the active extraction and move the application into manual recovery so it can be retried or deleted."
            : "This will permanently remove the selected application and its current draft. This action cannot be undone."
        }
        confirmLabel={rowActionTarget?.mode === "cancel_extraction" ? "Stop Extraction" : "Delete Application"}
        variant="danger"
        loading={isRowActionSubmitting}
        onConfirm={() => {
          void handleRowActionConfirm();
        }}
        onCancel={() => {
          if (!isRowActionSubmitting) {
            setRowActionTarget(null);
          }
        }}
      />
    </div>
  );
}
