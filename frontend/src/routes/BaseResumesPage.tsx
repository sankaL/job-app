import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
      .catch((requestError: Error) => setError(requestError.message));
  }

  async function handleSetDefault(resumeId: string) {
    setActionInProgress(resumeId);
    setError(null);
    try {
      await setDefaultBaseResume(resumeId);
      loadResumes();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to set default resume.");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleDelete(resume: BaseResumeSummary) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${resume.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    setActionInProgress(resume.id);
    setError(null);
    try {
      await deleteBaseResume(resume.id);
      loadResumes();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to delete resume.");
    } finally {
      setActionInProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="bg-white/80">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Base Resumes</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Resume Library</h2>
            <p className="mt-3 max-w-2xl text-ink/65">
              Base resumes are your master templates. Upload an existing PDF or start from scratch to
              create resumes you can tailor for specific job applications.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => navigate("/app/resumes/new?mode=upload")}>
              Upload PDF
            </Button>
            <Button onClick={() => navigate("/app/resumes/new?mode=blank")}>
              Start from Scratch
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-ember/20 bg-ember/5 text-ember">
          <p className="font-semibold">Request failed</p>
          <p className="mt-2 text-base">{error}</p>
        </Card>
      ) : null}

      {resumes === null ? (
        <div className="grid gap-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} className="animate-pulse bg-white/70">
              <div className="h-4 w-28 rounded bg-black/10" />
              <div className="mt-4 h-8 w-2/3 rounded bg-black/10" />
              <div className="mt-4 h-4 w-full rounded bg-black/10" />
            </Card>
          ))}
        </div>
      ) : resumes.length === 0 ? (
        <Card className="bg-canvas">
          <p className="text-sm uppercase tracking-[0.18em] text-ink/45">No resumes yet</p>
          <h3 className="mt-3 font-display text-3xl text-ink">
            Upload a PDF or start from scratch to create your first base resume.
          </h3>
          <p className="mt-3 text-ink/65">
            Base resumes contain your work history, skills, and achievements in Markdown format.
            They serve as the foundation for tailoring job-specific applications.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => navigate("/app/resumes/new?mode=upload")}>
              Upload PDF
            </Button>
            <Button onClick={() => navigate("/app/resumes/new?mode=blank")}>
              Start from Scratch
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {resumes.map((resume) => (
            <Card
              key={resume.id}
              className="transition hover:border-spruce/30"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {resume.is_default ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-spruce/10 px-3 py-1 text-xs font-semibold text-spruce">
                        <svg
                          className="h-3.5 w-3.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        Default
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-2 truncate font-display text-2xl text-ink">
                    {resume.name}
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink/65">
                    <div>Created {new Date(resume.created_at).toLocaleDateString()}</div>
                    <div>Updated {new Date(resume.updated_at).toLocaleString()}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/app/resumes/${resume.id}`)}
                  >
                    Edit
                  </Button>
                  {!resume.is_default ? (
                    <Button
                      variant="secondary"
                      disabled={actionInProgress === resume.id}
                      onClick={() => void handleSetDefault(resume.id)}
                    >
                      Set as Default
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    className="border-ember/30 text-ember hover:bg-ember/5 hover:border-ember"
                    disabled={actionInProgress === resume.id}
                    onClick={() => void handleDelete(resume)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
