import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
  deleteBaseResume,
  listBaseResumes,
  setDefaultBaseResume,
  type BaseResumeSummary,
} from "@/lib/api";

export function BaseResumesPage() {
  const navigate = useNavigate();
  const [resumes, setResumes] = useState<BaseResumeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  useEffect(() => {
    loadResumes();
  }, []);

  function loadResumes() {
    setResumes(null);
    setError(null);
    listBaseResumes()
      .then(setResumes)
      .catch((err: Error) => setError(err.message));
  }

  async function handleSetDefault(resumeId: string) {
    setActionInProgress(resumeId);
    setError(null);
    try {
      await setDefaultBaseResume(resumeId);
      loadResumes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default resume.");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleDelete(resume: BaseResumeSummary) {
    const confirmed = window.confirm(`Are you sure you want to delete "${resume.name}"? This action cannot be undone.`);
    if (!confirmed) return;
    setActionInProgress(resume.id);
    setError(null);
    try {
      await deleteBaseResume(resume.id);
      loadResumes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete resume.");
    } finally {
      setActionInProgress(null);
    }
  }

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Resumes"
        subtitle="Manage your base resume templates"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate("/app/resumes/new?mode=upload")}>Upload PDF</Button>
            <Button onClick={() => navigate("/app/resumes/new?mode=blank")}>Start from Scratch</Button>
          </div>
        }
      />

      {error && (
        <Card variant="danger">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Request failed</p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{error}</p>
        </Card>
      )}

      {resumes === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : resumes.length === 0 ? (
        <EmptyState
          title="No resumes yet"
          description="Upload a PDF or start from scratch to create your first base resume. These serve as the foundation for tailoring job-specific applications."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate("/app/resumes/new?mode=upload")}>Upload PDF</Button>
              <Button onClick={() => navigate("/app/resumes/new?mode=blank")}>Start from Scratch</Button>
            </div>
          }
        />
      ) : (
        <div className="stagger-children grid gap-4 sm:grid-cols-2">
          {resumes.map((resume) => (
            <Card key={resume.id} className="transition-all hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-display text-lg font-semibold" style={{ color: "var(--color-ink)" }}>
                      {resume.name}
                    </h3>
                    {resume.is_default && (
                      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: "var(--color-spruce-10)", color: "var(--color-spruce)" }}>
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        Default
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--color-ink-40)" }}>
                    <span>Created {new Date(resume.created_at).toLocaleDateString()}</span>
                    <span>Updated {new Date(resume.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => navigate(`/app/resumes/${resume.id}`)}>Edit</Button>
                {!resume.is_default && (
                  <Button size="sm" variant="secondary" disabled={actionInProgress === resume.id} onClick={() => void handleSetDefault(resume.id)}>
                    Set Default
                  </Button>
                )}
                <Button size="sm" variant="danger" disabled={actionInProgress === resume.id} onClick={() => void handleDelete(resume)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
