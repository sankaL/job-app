import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CircleStop, Trash2 } from "lucide-react";
import { CreateApplicationModal } from "@/components/applications/CreateApplicationModal";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/StatusBadge";
import { AppliedToggleButton } from "@/components/AppliedToggleButton";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
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
import {
  invalidateApplicationQueries,
  queryKeys,
  useApplicationsQuery,
} from "@/lib/queries";

const ACTIVE_EXTRACTION_STATES = new Set(["extraction_pending", "extracting"]);
const ACTIVE_DELETE_BLOCKING_STATES = new Set([
  "extraction_pending",
  "extracting",
  "generating",
  "regenerating_full",
  "regenerating_section",
]);
const ACTIVE_NON_EXTRACTION_DELETE_BLOCKING_STATES = new Set([
  "generating",
  "regenerating_full",
  "regenerating_section",
]);
const STATUS_ORDER: Record<string, number> = {
  needs_action: 0,
  in_progress: 1,
  draft: 2,
  complete: 3,
};

function areIdsEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function formatApplicationCount(count: number) {
  return `${count} application${count === 1 ? "" : "s"}`;
}

function getSettledErrorMessage(result: PromiseSettledResult<unknown>) {
  if (result.status !== "rejected") {
    return null;
  }

  return result.reason instanceof Error
    ? result.reason.message
    : "Request failed.";
}

function ApplicationFilterSelects({
  status,
  applied,
  onStatusChange,
  onAppliedChange,
  className,
}: {
  status: string;
  applied: string;
  onStatusChange: (value: string) => void;
  onAppliedChange: (value: string) => void;
  className: string;
}) {
  return (
    <>
      <Select
        aria-label="Filter by status"
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        className={className}
      >
        <option value="all">All statuses</option>
        <option value="draft">Draft</option>
        <option value="needs_action">Needs Action</option>
        <option value="in_progress">In Progress</option>
        <option value="complete">Complete</option>
      </Select>
      <Select
        aria-label="Filter by applied"
        value={applied}
        onChange={(event) => onAppliedChange(event.target.value)}
        className={className}
      >
        <option value="all">All</option>
        <option value="applied">Applied</option>
        <option value="not_applied">Not Applied</option>
      </Select>
    </>
  );
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

function ApplicationTitleCell({
  application,
}: {
  application: ApplicationSummary;
}) {
  const actionRequired =
    application.has_action_required_notification &&
    application.visible_status !== "needs_action";
  const notice = actionRequired
    ? "Action required"
    : application.has_unresolved_duplicate
      ? "Duplicate review pending"
      : null;
  const noticeColor = actionRequired
    ? "var(--color-ember)"
    : "var(--color-spruce)";
  return (
    <div className="flex min-w-0 flex-col justify-center">
      <div
        className="truncate whitespace-nowrap text-sm font-medium"
        style={{ color: "var(--color-ink)" }}
      >
        {application.job_title ?? "Awaiting extraction"}
      </div>
      {notice && (
        <div
          className="truncate text-[10px] font-medium leading-[1.2]"
          style={{ color: noticeColor }}
        >
          {notice}
        </div>
      )}
    </div>
  );
}

function ApplicationActionsCell({
  application,
  onAppliedClick,
  onRowAction,
}: {
  application: ApplicationSummary;
  onAppliedClick: (event: React.MouseEvent) => void;
  onRowAction: (mode: "delete" | "cancel_extraction") => void;
}) {
  const extractionActive = ACTIVE_EXTRACTION_STATES.has(
    application.internal_state,
  );
  const deleteBlocked = ACTIVE_NON_EXTRACTION_DELETE_BLOCKING_STATES.has(
    application.internal_state,
  );
  const label = application.job_title ?? application.company ?? "application";
  return (
    <div
      className="flex items-center justify-end gap-2"
      onClick={(event) => event.stopPropagation()}
    >
      <AppliedToggleButton
        applied={application.applied}
        compact
        onClick={onAppliedClick}
      />
      {extractionActive ? (
        <IconButton
          variant="danger"
          aria-label={`Stop extraction for ${label}`}
          title="Stop extraction"
          onClick={() => onRowAction("cancel_extraction")}
        >
          <CircleStop size={16} aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton
          variant="danger"
          aria-label={
            deleteBlocked
              ? `Delete unavailable while ${label} is still processing`
              : `Delete ${label}`
          }
          title={
            deleteBlocked
              ? "Delete unavailable while background work is still running."
              : "Delete application"
          }
          disabled={deleteBlocked}
          onClick={() => onRowAction("delete")}
        >
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}

function buildApplicationColumns({
  selectedSet,
  allVisibleSelected,
  someVisibleSelected,
  visiblePageIds,
  onSelectVisible,
  onToggleSelected,
  onAppliedClick,
  onRowAction,
}: {
  selectedSet: Set<string>;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  visiblePageIds: string[];
  onSelectVisible: (checked: boolean) => void;
  onToggleSelected: (id: string, checked: boolean) => void;
  onAppliedClick: (app: ApplicationSummary, event: React.MouseEvent) => void;
  onRowAction: (
    mode: "delete" | "cancel_extraction",
    app: ApplicationSummary,
  ) => void;
}): Column<ApplicationSummary>[] {
  return [
    {
      key: "select",
      header: (
        <div className="flex items-start">
          <SelectionCheckbox
            checked={allVisibleSelected}
            indeterminate={someVisibleSelected}
            disabled={visiblePageIds.length === 0}
            ariaLabel="Select current page"
            onChange={(event) => onSelectVisible(event.target.checked)}
          />
        </div>
      ),
      width: "56px",
      hiddenOnMobile: true,
      render: (app) => (
        <div
          className="flex items-start"
          onClick={(event) => event.stopPropagation()}
        >
          <SelectionCheckbox
            checked={selectedSet.has(app.id)}
            ariaLabel={`Select ${app.job_title ?? app.company ?? "application"}`}
            onChange={(event) => onToggleSelected(app.id, event.target.checked)}
          />
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "132px",
      sortable: true,
      sortValue: (app) => STATUS_ORDER[app.visible_status] ?? 99,
      render: (app) => (
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
      sortValue: (app) => app.job_title?.toLowerCase() ?? "",
      render: (app) => <ApplicationTitleCell application={app} />,
    },
    {
      key: "company",
      header: "Company",
      width: "180px",
      sortable: true,
      sortValue: (app) => app.company?.toLowerCase() ?? "zzz",
      render: (app) => (
        <span
          className="block truncate text-sm"
          style={{ color: "var(--color-ink-65)" }}
        >
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
      sortValue: (app) => app.base_resume_name?.toLowerCase() ?? "zzz",
      render: (app) => (
        <span
          className="block truncate text-xs"
          style={{ color: "var(--color-ink-40)" }}
        >
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
      sortValue: (app) => new Date(app.updated_at).getTime(),
      render: (app) => (
        <span
          className="block text-xs tabular-nums"
          style={{ color: "var(--color-ink-40)" }}
        >
          {new Date(app.updated_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "196px",
      hiddenOnMobile: true,
      render: (app) => (
        <ApplicationActionsCell
          application={app}
          onAppliedClick={(event) => onAppliedClick(app, event)}
          onRowAction={(mode) => onRowAction(mode, app)}
        />
      ),
    },
  ];
}

type ApplicationsListViewProps = {
  applications: ApplicationSummary[] | undefined;
  displayedError: string | null;
  error: string | null;
  search: string;
  statusFilter: string;
  appliedFilter: string;
  showMobileFilters: boolean;
  selectedIds: string[];
  activeSelectedCount: number;
  isBulkApplying: boolean;
  isBulkDeleting: boolean;
  columns: Column<ApplicationSummary>[];
  filteredApplications: ApplicationSummary[];
  sourceApplications: ApplicationSummary[];
  showCreateModal: boolean;
  confirmAppliedId: string | null;
  deleteConfirmationOpen: boolean;
  rowActionTarget: {
    mode: "delete" | "cancel_extraction";
    application: ApplicationSummary;
  } | null;
  isRowActionSubmitting: boolean;
  setError: (value: string | null) => void;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setAppliedFilter: (value: string) => void;
  setShowMobileFilters: (value: boolean) => void;
  setShowCreateModal: (value: boolean) => void;
  setConfirmAppliedId: (value: string | null) => void;
  setDeleteConfirmationOpen: (value: boolean) => void;
  setRowActionTarget: (
    value: {
      mode: "delete" | "cancel_extraction";
      application: ApplicationSummary;
    } | null,
  ) => void;
  navigate: (path: string) => void;
  handleBulkMarkApplied: () => Promise<void>;
  handleBulkDelete: () => Promise<void>;
  handleRowActionConfirm: () => Promise<void>;
  handleVisibleRowsChange: (rows: ApplicationSummary[]) => void;
  handleCreateApplication: (payload: {
    job_url?: string;
    source_text?: string;
  }) => Promise<void>;
  handleAppliedToggle: (
    applicationId: string,
    applied: boolean,
  ) => Promise<void>;
};

function ApplicationsHeader({
  applications,
  onCreate,
}: {
  applications: ApplicationSummary[] | undefined;
  onCreate: () => void;
}) {
  const subtitle = applications
    ? `${applications.length} total · ${applications.filter((app) => app.applied).length} applied`
    : "Loading…";
  return (
    <PageHeader
      title="Applications"
      subtitle={subtitle}
      actions={<Button onClick={onCreate}>+ New Application</Button>}
    />
  );
}

function ApplicationsFilters({
  search,
  status,
  applied,
  mobileOpen,
  onSearch,
  onStatus,
  onApplied,
  onMobileOpen,
}: {
  search: string;
  status: string;
  applied: string;
  mobileOpen: boolean;
  onSearch: (value: string) => void;
  onStatus: (value: string) => void;
  onApplied: (value: string) => void;
  onMobileOpen: (value: boolean) => void;
}) {
  return (
    <>
      <div className="hidden gap-3 md:grid md:grid-cols-[minmax(0,1.8fr)_minmax(180px,0.8fr)_minmax(160px,0.7fr)] xl:grid-cols-[minmax(320px,2.2fr)_240px_220px]">
        <Input
          aria-label="Search applications"
          placeholder="Search title or company…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="w-full"
        />
        <ApplicationFilterSelects
          status={status}
          applied={applied}
          onStatusChange={onStatus}
          onAppliedChange={onApplied}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        <div className="flex gap-2">
          <Input
            aria-label="Search applications"
            placeholder="Search…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            className="flex-1"
          />
          <button
            type="button"
            className="mobile-filters-toggle"
            onClick={() => onMobileOpen(!mobileOpen)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2 4h12M4 8h8M6 12h4" />
            </svg>
            Filters
          </button>
        </div>
        {mobileOpen && (
          <div className="flex gap-2">
            <ApplicationFilterSelects
              status={status}
              applied={applied}
              onStatusChange={onStatus}
              onAppliedChange={onApplied}
              className="flex-1"
            />
          </div>
        )}
      </div>
    </>
  );
}

function BulkSelectionCard({
  count,
  activeCount,
  applying,
  deleting,
  onApply,
  onDelete,
}: {
  count: number;
  activeCount: number;
  applying: boolean;
  deleting: boolean;
  onApply: () => void;
  onDelete: () => void;
}) {
  if (count === 0) return null;
  const warning =
    activeCount === 1
      ? "Delete is unavailable while 1 selected application is still processing."
      : `Delete is unavailable while ${activeCount} selected applications are still processing.`;
  return (
    <Card variant="default" density="compact">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            {formatApplicationCount(count)} selected
          </p>
          {activeCount > 0 && (
            <p className="text-xs" style={{ color: "var(--color-ember)" }}>
              {warning}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onApply}
            loading={applying}
            disabled={applying || deleting}
          >
            Mark Applied
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
            disabled={applying || deleting || activeCount > 0}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ApplicationsTableSection({
  applications,
  columns,
  filtered,
  source,
  onNavigate,
  onVisibleRows,
  onCreate,
}: {
  applications: ApplicationSummary[] | undefined;
  columns: Column<ApplicationSummary>[];
  filtered: ApplicationSummary[];
  source: ApplicationSummary[];
  onNavigate: (id: string) => void;
  onVisibleRows: (rows: ApplicationSummary[]) => void;
  onCreate: () => void;
}) {
  if (!applications) return <SkeletonTable rows={8} columns={7} />;
  const empty = source.length === 0;
  const emptyState = (
    <EmptyState
      title={empty ? "No applications yet" : "No matching applications"}
      description={
        empty
          ? "Open the new application modal to create your first application from a job link."
          : "Try adjusting your search or filter criteria."
      }
      action={
        empty ? (
          <Button onClick={onCreate}>+ New Application</Button>
        ) : undefined
      }
    />
  );
  return (
    <DataTable
      columns={columns}
      data={filtered}
      getRowKey={(app) => app.id}
      onRowClick={(app) => onNavigate(app.id)}
      pageSize={25}
      density="compact"
      tableLayout="fixed"
      verticalAlign="middle"
      onVisibleRowsChange={onVisibleRows}
      emptyState={emptyState}
    />
  );
}

function AppliedConfirmation({
  applicationId,
  onConfirm,
  onClose,
}: {
  applicationId: string | null;
  onConfirm: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <ConfirmModal
      open={applicationId !== null}
      title="Mark as Applied?"
      message="This will mark the application as submitted. You can always change this later."
      confirmLabel="Yes, Mark Applied"
      onConfirm={() => {
        if (applicationId) onConfirm(applicationId);
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

function BulkDeleteConfirmation({
  open,
  count,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  count: number;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const singular = count === 1;
  const message = singular
    ? "This will permanently remove the selected application and its current draft. This action cannot be undone."
    : `This will permanently remove ${count} selected applications and their current drafts. This action cannot be undone.`;
  return (
    <ConfirmModal
      open={open}
      title={singular ? "Delete application?" : "Delete applications?"}
      message={message}
      confirmLabel={singular ? "Delete Application" : "Delete Applications"}
      variant="danger"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={() => {
        if (!loading) onClose();
      }}
    />
  );
}

function RowActionConfirmation({
  target,
  loading,
  onConfirm,
  onClose,
}: {
  target: ApplicationsListViewProps["rowActionTarget"];
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const stopping = target?.mode === "cancel_extraction";
  return (
    <ConfirmModal
      open={target !== null}
      title={stopping ? "Stop extraction?" : "Delete application?"}
      message={
        stopping
          ? "This will stop the active extraction and move the application into manual recovery so it can be retried or deleted."
          : "This will permanently remove the selected application and its current draft. This action cannot be undone."
      }
      confirmLabel={stopping ? "Stop Extraction" : "Delete Application"}
      variant="danger"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={() => {
        if (!loading) onClose();
      }}
    />
  );
}

function ApplicationListModals(
  props: Pick<
    ApplicationsListViewProps,
    | "showCreateModal"
    | "confirmAppliedId"
    | "deleteConfirmationOpen"
    | "selectedIds"
    | "isBulkDeleting"
    | "rowActionTarget"
    | "isRowActionSubmitting"
    | "setShowCreateModal"
    | "setConfirmAppliedId"
    | "setDeleteConfirmationOpen"
    | "setRowActionTarget"
    | "handleCreateApplication"
    | "handleAppliedToggle"
    | "handleBulkDelete"
    | "handleRowActionConfirm"
  >,
) {
  return (
    <>
      <CreateApplicationModal
        open={props.showCreateModal}
        onClose={() => props.setShowCreateModal(false)}
        onSubmit={props.handleCreateApplication}
      />
      <AppliedConfirmation
        applicationId={props.confirmAppliedId}
        onConfirm={(id) => void props.handleAppliedToggle(id, true)}
        onClose={() => props.setConfirmAppliedId(null)}
      />
      <BulkDeleteConfirmation
        open={props.deleteConfirmationOpen}
        count={props.selectedIds.length}
        loading={props.isBulkDeleting}
        onConfirm={() => void props.handleBulkDelete()}
        onClose={() => props.setDeleteConfirmationOpen(false)}
      />
      <RowActionConfirmation
        target={props.rowActionTarget}
        loading={props.isRowActionSubmitting}
        onConfirm={() => void props.handleRowActionConfirm()}
        onClose={() => props.setRowActionTarget(null)}
      />
    </>
  );
}

function ApplicationsListView(props: ApplicationsListViewProps) {
  return (
    <div className="page-enter space-y-5">
      <ApplicationsHeader
        applications={props.applications}
        onCreate={() => props.setShowCreateModal(true)}
      />
      <ErrorBanner
        error={props.displayedError}
        className="mb-4"
        onClear={props.error ? () => props.setError(null) : undefined}
      />
      <ApplicationsFilters
        search={props.search}
        status={props.statusFilter}
        applied={props.appliedFilter}
        mobileOpen={props.showMobileFilters}
        onSearch={props.setSearch}
        onStatus={props.setStatusFilter}
        onApplied={props.setAppliedFilter}
        onMobileOpen={props.setShowMobileFilters}
      />
      <BulkSelectionCard
        count={props.selectedIds.length}
        activeCount={props.activeSelectedCount}
        applying={props.isBulkApplying}
        deleting={props.isBulkDeleting}
        onApply={() => void props.handleBulkMarkApplied()}
        onDelete={() => props.setDeleteConfirmationOpen(true)}
      />
      <ApplicationsTableSection
        applications={props.applications}
        columns={props.columns}
        filtered={props.filteredApplications}
        source={props.sourceApplications}
        onNavigate={(id) => props.navigate(`/app/applications/${id}`)}
        onVisibleRows={props.handleVisibleRowsChange}
        onCreate={() => props.setShowCreateModal(true)}
      />
      <ApplicationListModals {...props} />
    </div>
  );
}

export function ApplicationsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
  const { data: applications, error: queryError } = useApplicationsQuery();
  const sourceApplications = applications ?? [];
  const requestError = queryError instanceof Error ? queryError.message : null;
  const displayedError = error ?? requestError;
  const searchTerm = deferredSearch.trim().toLowerCase();
  const filteredApplications = sourceApplications.filter((app) => {
    const matchesSearch =
      !searchTerm ||
      app.job_title?.toLowerCase().includes(searchTerm) ||
      app.company?.toLowerCase().includes(searchTerm);
    const matchesStatus =
      statusFilter === "all" ? true : app.visible_status === statusFilter;
    const matchesApplied =
      appliedFilter === "all"
        ? true
        : appliedFilter === "applied"
          ? app.applied
          : !app.applied;
    return matchesSearch && matchesStatus && matchesApplied;
  });
  const selectedSet = new Set(selectedIds);
  const selectedApplications = filteredApplications.filter((app) =>
    selectedSet.has(app.id),
  );
  const selectedVisibleCount = visiblePageIds.filter((id) =>
    selectedSet.has(id),
  ).length;
  const allVisibleSelected =
    visiblePageIds.length > 0 && selectedVisibleCount === visiblePageIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const bulkApplicableIds = selectedApplications
    .filter((app) => !app.applied)
    .map((app) => app.id);
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

  async function handleCreateApplication(payload: {
    job_url?: string;
    source_text?: string;
  }) {
    const detail = await createApplication(payload);
    queryClient.setQueryData(queryKeys.application(detail.id), detail);
    await invalidateApplicationQueries(queryClient, detail.id);
    toast("Application created successfully");
    navigate(`/app/applications/${detail.id}`);
  }

  async function handleAppliedToggle(applicationId: string, applied: boolean) {
    if (!applications) return;
    const previous = queryClient.getQueryData<ApplicationSummary[]>(
      queryKeys.applications,
    );
    queryClient.setQueryData<ApplicationSummary[] | undefined>(
      queryKeys.applications,
      (current) =>
        current?.map((a) => (a.id === applicationId ? { ...a, applied } : a)),
    );
    try {
      const detail = await patchApplication(applicationId, { applied });
      queryClient.setQueryData(queryKeys.application(applicationId), detail);
      queryClient.setQueryData<ApplicationSummary[] | undefined>(
        queryKeys.applications,
        (current) =>
          current?.map((a) =>
            a.id === applicationId
              ? {
                  ...a,
                  applied: detail.applied,
                  visible_status: detail.visible_status,
                  internal_state: detail.internal_state,
                  failure_reason: detail.failure_reason,
                  updated_at: detail.updated_at,
                  has_action_required_notification:
                    detail.has_action_required_notification,
                  duplicate_resolution_status:
                    detail.duplicate_resolution_status,
                  has_unresolved_duplicate:
                    detail.duplicate_resolution_status === "pending",
                }
              : a,
          ),
      );
      await invalidateApplicationQueries(queryClient, applicationId);
      toast(applied ? "Marked as applied" : "Unmarked as applied");
    } catch (err) {
      queryClient.setQueryData(queryKeys.applications, previous);
      setError(
        err instanceof Error ? err.message : "Unable to update applied state.",
      );
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
    setVisiblePageIds((current) =>
      areIdsEqual(current, nextIds) ? current : nextIds,
    );
  }

  function toggleSelectedId(applicationId: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(applicationId)
          ? current
          : [...current, applicationId];
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
    await invalidateApplicationQueries(queryClient);
  }

  async function reconcileBulkResults(
    ids: string[],
    results: PromiseSettledResult<unknown>[],
  ) {
    const failedIds = ids.filter(
      (_, index) => results[index].status === "rejected",
    );
    const successCount = ids.length - failedIds.length;
    await syncApplicationLists();
    setSelectedIds(failedIds);
    const failedResult = results.find((result) => result.status === "rejected");
    const firstError = failedResult
      ? getSettledErrorMessage(failedResult)
      : null;
    if (firstError) setError(firstError);
    return { failedIds, successCount };
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
        bulkApplicableIds.map((applicationId) =>
          patchApplication(applicationId, { applied: true }),
        ),
      );
      const { failedIds, successCount } = await reconcileBulkResults(
        bulkApplicableIds,
        results,
      );

      if (failedIds.length === 0) {
        toast(`Marked ${formatApplicationCount(successCount)} as applied.`);
        return;
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
      const { failedIds, successCount } = await reconcileBulkResults(
        deleteIds,
        results,
      );
      setDeleteConfirmationOpen(false);

      if (failedIds.length === 0) {
        toast(`Deleted ${formatApplicationCount(successCount)}.`);
        return;
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
      toast(
        rowActionTarget.mode === "delete"
          ? "Failed to delete application"
          : "Failed to stop extraction",
        "error",
      );
    } finally {
      setIsRowActionSubmitting(false);
    }
  }

  const columns = buildApplicationColumns({
    selectedSet,
    allVisibleSelected,
    someVisibleSelected,
    visiblePageIds,
    onSelectVisible: handleSelectVisible,
    onToggleSelected: toggleSelectedId,
    onAppliedClick: handleAppliedClick,
    onRowAction: (mode, application) =>
      setRowActionTarget({ mode, application }),
  });

  return (
    <ApplicationsListView
      applications={applications}
      displayedError={displayedError}
      error={error}
      search={search}
      statusFilter={statusFilter}
      appliedFilter={appliedFilter}
      showMobileFilters={showMobileFilters}
      selectedIds={selectedIds}
      activeSelectedCount={activeSelectedCount}
      isBulkApplying={isBulkApplying}
      isBulkDeleting={isBulkDeleting}
      columns={columns}
      filteredApplications={filteredApplications}
      sourceApplications={sourceApplications}
      showCreateModal={showCreateModal}
      confirmAppliedId={confirmAppliedId}
      deleteConfirmationOpen={deleteConfirmationOpen}
      rowActionTarget={rowActionTarget}
      isRowActionSubmitting={isRowActionSubmitting}
      setError={setError}
      setSearch={setSearch}
      setStatusFilter={setStatusFilter}
      setAppliedFilter={setAppliedFilter}
      setShowMobileFilters={setShowMobileFilters}
      setShowCreateModal={setShowCreateModal}
      setConfirmAppliedId={setConfirmAppliedId}
      setDeleteConfirmationOpen={setDeleteConfirmationOpen}
      setRowActionTarget={setRowActionTarget}
      navigate={navigate}
      handleBulkMarkApplied={handleBulkMarkApplied}
      handleBulkDelete={handleBulkDelete}
      handleRowActionConfirm={handleRowActionConfirm}
      handleVisibleRowsChange={handleVisibleRowsChange}
      handleCreateApplication={handleCreateApplication}
      handleAppliedToggle={handleAppliedToggle}
    />
  );
}
