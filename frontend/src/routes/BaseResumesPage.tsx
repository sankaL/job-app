import { useDeferredValue, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useToast } from "@/components/ui/toast";
import {
  deleteBaseResume,
  setDefaultBaseResume,
  type BaseResumeSummary,
} from "@/lib/api";
import {
  invalidateBaseResumeQueries,
  useBaseResumesQuery,
} from "@/lib/queries";

function ResumeActions({
  resume,
  busy,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  resume: BaseResumeSummary;
  busy: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
      <Button size="sm" variant="secondary" onClick={onEdit}>
        Edit
      </Button>
      {!resume.is_default && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={onSetDefault}
        >
          Set Default
        </Button>
      )}
      <IconButton
        variant="danger"
        aria-label={`Delete ${resume.name}`}
        title="Delete resume"
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 size={16} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function ResumeCard({
  resume,
  busy,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  resume: BaseResumeSummary;
  busy: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <Card density="compact" className="transition-all hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              className="truncate font-display text-lg font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {resume.name}
            </h3>
            {resume.is_default && (
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  background: "var(--color-spruce-10)",
                  color: "var(--color-spruce)",
                }}
              >
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                Default
              </span>
            )}
          </div>
          <div
            className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs"
            style={{ color: "var(--color-ink-40)" }}
          >
            <span>
              Created {new Date(resume.created_at).toLocaleDateString()}
            </span>
            <span>
              Updated {new Date(resume.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <ResumeActions
          resume={resume}
          busy={busy}
          onEdit={onEdit}
          onSetDefault={onSetDefault}
          onDelete={onDelete}
        />
      </div>
    </Card>
  );
}

function ResumeCollection({
  resumes,
  search,
  actionInProgress,
  onSearchChange,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  resumes: BaseResumeSummary[];
  search: string;
  actionInProgress: string | null;
  onSearchChange: (value: string) => void;
  onEdit: (id: string) => void;
  onSetDefault: (id: string) => void;
  onDelete: (resume: BaseResumeSummary) => void;
}) {
  if (resumes.length === 0)
    return (
      <EmptyState
        title="No matching resumes"
        description="Try a different search term."
      />
    );
  return (
    <>
      <div className="max-w-md">
        <Input
          aria-label="Search resumes"
          placeholder="Search resumes…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className="stagger-children grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
        {resumes.map((resume) => (
          <ResumeCard
            key={resume.id}
            resume={resume}
            busy={actionInProgress === resume.id}
            onEdit={() => onEdit(resume.id)}
            onSetDefault={() => onSetDefault(resume.id)}
            onDelete={() => onDelete(resume)}
          />
        ))}
      </div>
    </>
  );
}

function BaseResumeContent({
  resumes,
  filteredResumes,
  search,
  actionInProgress,
  onSearchChange,
  onCreate,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  resumes: BaseResumeSummary[] | undefined;
  filteredResumes: BaseResumeSummary[];
  search: string;
  actionInProgress: string | null;
  onSearchChange: (value: string) => void;
  onCreate: (mode: "upload" | "blank") => void;
  onEdit: (id: string) => void;
  onSetDefault: (id: string) => void;
  onDelete: (resume: BaseResumeSummary) => void;
}) {
  if (!resumes)
    return (
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {Array.from({ length: 2 }).map((_, index) => (
          <SkeletonCard key={index} density="compact" />
        ))}
      </div>
    );
  if (resumes.length === 0)
    return (
      <EmptyState
        title="No resumes yet"
        description="Upload a PDF or start from scratch to create your first base resume. These serve as the foundation for tailoring job-specific applications."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onCreate("upload")}>
              Upload PDF
            </Button>
            <Button onClick={() => onCreate("blank")}>
              Start from Scratch
            </Button>
          </div>
        }
      />
    );
  return (
    <ResumeCollection
      resumes={filteredResumes}
      search={search}
      actionInProgress={actionInProgress}
      onSearchChange={onSearchChange}
      onEdit={onEdit}
      onSetDefault={onSetDefault}
      onDelete={onDelete}
    />
  );
}

export function BaseResumesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BaseResumeSummary | null>(
    null,
  );
  const { toast } = useToast();
  const deferredSearch = useDeferredValue(search);
  const { data: resumes, error: queryError } = useBaseResumesQuery();
  const displayedError =
    error ?? (queryError instanceof Error ? queryError.message : null);

  async function handleSetDefault(resumeId: string) {
    setActionInProgress(resumeId);
    setError(null);
    try {
      await setDefaultBaseResume(resumeId);
      toast("Default resume updated");
      await invalidateBaseResumeQueries(queryClient);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set default resume.",
      );
      toast("Failed to set default", "error");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionInProgress(deleteTarget.id);
    setError(null);
    try {
      await deleteBaseResume(deleteTarget.id);
      toast(`"${deleteTarget.name}" deleted`);
      await invalidateBaseResumeQueries(queryClient);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete resume.");
      toast("Failed to delete resume", "error");
    } finally {
      setActionInProgress(null);
    }
  }

  const filteredResumes = (resumes ?? []).filter((resume) =>
    resume.name.toLowerCase().includes(deferredSearch.trim().toLowerCase()),
  );

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Resumes"
        subtitle="Manage your base resume templates"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => navigate("/app/resumes/new?mode=upload")}
            >
              Upload PDF
            </Button>
            <Button onClick={() => navigate("/app/resumes/new?mode=blank")}>
              Start from Scratch
            </Button>
          </div>
        }
      />

      <ErrorBanner
        error={displayedError}
        className="mb-4"
        onClear={error ? () => setError(null) : undefined}
      />

      <BaseResumeContent
        resumes={resumes}
        filteredResumes={filteredResumes}
        search={search}
        actionInProgress={actionInProgress}
        onSearchChange={setSearch}
        onCreate={(mode) => navigate(`/app/resumes/new?mode=${mode}`)}
        onEdit={(id) => navigate(`/app/resumes/${id}`)}
        onSetDefault={(id) => void handleSetDefault(id)}
        onDelete={setDeleteTarget}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete resume?"
        message={`This will permanently remove "${deleteTarget?.name ?? "this resume"}". This action cannot be undone.`}
        confirmLabel="Delete Resume"
        variant="danger"
        loading={deleteTarget !== null && actionInProgress === deleteTarget.id}
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => {
          if (deleteTarget === null || actionInProgress !== deleteTarget.id) {
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
