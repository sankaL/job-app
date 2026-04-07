import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createBaseResume,
  deleteBaseResume,
  fetchBaseResume,
  setDefaultBaseResume,
  updateBaseResume,
  uploadBaseResume,
  type BaseResumeDetail,
} from "@/lib/api";

type SaveState = "idle" | "saving" | "saved";

export function BaseResumeEditorPage() {
  const navigate = useNavigate();
  const { resumeId } = useParams<{ resumeId: string }>();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isNew = resumeId === undefined || resumeId === "new";
  const mode = searchParams.get("mode");

  const [resume, setResume] = useState<BaseResumeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contentMd, setContentMd] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [uploadedResume, setUploadedResume] = useState<BaseResumeDetail | null>(null);
  const [useLlmCleanup, setUseLlmCleanup] = useState(true);

  // Load existing resume
  useEffect(() => {
    if (isNew || !resumeId) return;

    fetchBaseResume(resumeId)
      .then((response) => {
        setResume(response);
        setName(response.name);
        setContentMd(response.content_md);
        setError(null);
      })
      .catch((requestError: Error) => setError(requestError.message));
  }, [isNew, resumeId]);

  // Handle save for existing resume
  async function handleSave() {
    if (!resumeId || isNew) return;

    setSaveState("saving");
    setError(null);
    try {
      const response = await updateBaseResume(resumeId, { name, content_md: contentMd });
      setResume(response);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save resume.");
      setSaveState("idle");
    }
  }

  // Handle create for blank mode
  async function handleCreateBlank(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Please enter a name for the resume.");
      return;
    }

    setSaveState("saving");
    setError(null);
    try {
      const response = await createBaseResume(name, contentMd);
      navigate(`/app/resumes/${response.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to create resume.");
      setSaveState("idle");
    }
  }

  // Handle upload
  async function handleUpload(event: FormEvent) {
    event.preventDefault();

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please select a PDF file to upload.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter a name for the resume.");
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const response = await uploadBaseResume(file, name, useLlmCleanup);
      setUploadedResume(response);
      setContentMd(response.content_md);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to upload resume.");
    } finally {
      setIsUploading(false);
    }
  }

  // Handle save after upload review
  async function handleSaveUploaded() {
    if (!uploadedResume) return;

    setSaveState("saving");
    setError(null);
    try {
      const response = await updateBaseResume(uploadedResume.id, { name, content_md: contentMd });
      navigate(`/app/resumes/${response.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save resume.");
      setSaveState("idle");
    }
  }

  // Handle delete
  async function handleDelete() {
    if (!resume) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${resume.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setError(null);
    try {
      await deleteBaseResume(resume.id);
      navigate("/app/resumes");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to delete resume.");
      setIsDeleting(false);
    }
  }

  // Handle set as default
  async function handleSetDefault() {
    if (!resume) return;

    setIsSettingDefault(true);
    setError(null);
    try {
      await setDefaultBaseResume(resume.id);
      setResume({ ...resume, is_default: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to set as default.");
    } finally {
      setIsSettingDefault(false);
    }
  }

  // Render upload mode (new with mode=upload)
  if (isNew && mode === "upload" && !uploadedResume) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="secondary" className="w-fit" onClick={() => navigate("/app/resumes")}>
          Back to Resumes
        </Button>

        {error ? (
          <Card className="border-ember/20 bg-ember/5 text-ember">
            <p className="font-semibold">Upload failed</p>
            <p className="mt-2 text-base">{error}</p>
          </Card>
        ) : null}

        <Card>
          <p className="text-sm uppercase tracking-[0.18em] text-ink/45">New Resume</p>
          <h2 className="mt-3 font-display text-3xl text-ink">Upload PDF</h2>
          <p className="mt-3 text-ink/65">
            Upload an existing resume in PDF format. The content will be extracted and converted to
            Markdown for editing.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleUpload}>
            <div>
              <Label htmlFor="name">Resume Name</Label>
              <Input
                id="name"
                placeholder="e.g., Senior Engineer Resume"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="file">PDF File</Label>
              <input
                ref={fileInputRef}
                accept=".pdf,application/pdf"
                className="mt-2 block w-full text-sm text-ink file:mr-4 file:rounded-full file:border-0 file:bg-spruce/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-spruce hover:file:bg-spruce/20"
                id="file"
                type="file"
              />
              <p className="mt-2 text-xs text-ink/50">Only PDF files are supported.</p>
            </div>

            <label className="inline-flex items-center gap-2">
              <input
                checked={useLlmCleanup}
                className="rounded border-ink/20 text-spruce focus:ring-spruce/15"
                type="checkbox"
                onChange={(e) => setUseLlmCleanup(e.target.checked)}
              />
              <span className="text-sm text-ink">Improve with AI (recommended)</span>
            </label>
            <p className="text-xs text-ink/50">
              AI cleanup fixes formatting issues and improves the structure of extracted content.
            </p>

            <div className="flex gap-3">
              <Button disabled={isUploading} type="submit">
                {isUploading ? "Uploading…" : "Upload & Parse"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  // Render upload review mode (after upload)
  if (isNew && mode === "upload" && uploadedResume) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="secondary" className="w-fit" onClick={() => navigate("/app/resumes")}>
          Back to Resumes
        </Button>

        {error ? (
          <Card className="border-ember/20 bg-ember/5 text-ember">
            <p className="font-semibold">Save failed</p>
            <p className="mt-2 text-base">{error}</p>
          </Card>
        ) : null}

        <Card>
          <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Review & Save</p>
          <h2 className="mt-3 font-display text-3xl text-ink">{name}</h2>
          <p className="mt-3 text-ink/65">
            Review the extracted content below. You can edit the name and content before saving.
          </p>

          <form className="mt-6 space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSaveUploaded(); }}>
            <div>
              <Label htmlFor="name">Resume Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="content">Content (Markdown)</Label>
              <textarea
                className="mt-2 min-h-[500px] w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 font-mono text-sm text-ink outline-none transition focus:border-spruce focus:ring-2 focus:ring-spruce/15"
                id="content"
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <Button disabled={saveState === "saving"} type="submit">
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save Resume"}
              </Button>
              <Button variant="secondary" onClick={() => setUploadedResume(null)}>
                Re-upload
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  // Render blank mode (new with mode=blank)
  if (isNew && mode === "blank") {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="secondary" className="w-fit" onClick={() => navigate("/app/resumes")}>
          Back to Resumes
        </Button>

        {error ? (
          <Card className="border-ember/20 bg-ember/5 text-ember">
            <p className="font-semibold">Create failed</p>
            <p className="mt-2 text-base">{error}</p>
          </Card>
        ) : null}

        <Card>
          <p className="text-sm uppercase tracking-[0.18em] text-ink/45">New Resume</p>
          <h2 className="mt-3 font-display text-3xl text-ink">Start from Scratch</h2>
          <p className="mt-3 text-ink/65">
            Create a new resume from scratch using Markdown. Add your work history, skills, and
            achievements.
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleCreateBlank}>
            <div>
              <Label htmlFor="name">Resume Name</Label>
              <Input
                id="name"
                placeholder="e.g., Senior Engineer Resume"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="content">Content (Markdown)</Label>
              <textarea
                className="mt-2 min-h-[500px] w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 font-mono text-sm text-ink outline-none transition placeholder:text-ink/40 focus:border-spruce focus:ring-2 focus:ring-spruce/15"
                id="content"
                placeholder="# Your Name

## Summary
Brief professional summary...

## Experience

### Job Title - Company
- Accomplishment 1
- Accomplishment 2

## Skills
- Skill 1
- Skill 2"
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <Button disabled={saveState === "saving"} type="submit">
                {saveState === "saving" ? "Creating…" : "Create Resume"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  // Render existing resume editor
  return (
    <div className="flex flex-col gap-6">
      <Button variant="secondary" className="w-fit" onClick={() => navigate("/app/resumes")}>
        Back to Resumes
      </Button>

      {error ? (
        <Card className="border-ember/20 bg-ember/5 text-ember">
          <p className="font-semibold">Request failed</p>
          <p className="mt-2 text-base">{error}</p>
        </Card>
      ) : null}

      {!resume ? (
        <Card className="animate-pulse">
          <div className="h-4 w-32 rounded bg-black/10" />
          <div className="mt-4 h-10 w-3/4 rounded bg-black/10" />
          <div className="mt-4 h-4 w-full rounded bg-black/10" />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Edit Resume</p>
              <div className="mt-3 flex items-center gap-3">
                <h2 className="font-display text-3xl text-ink">{resume.name}</h2>
                {resume.is_default ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-spruce/10 px-3 py-1 text-xs font-semibold text-spruce">
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    Default
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-ink/65">
                Created {new Date(resume.created_at).toLocaleDateString()} · Updated{" "}
                {new Date(resume.updated_at).toLocaleString()}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {!resume.is_default ? (
                <Button
                  variant="secondary"
                  disabled={isSettingDefault}
                  onClick={() => void handleSetDefault()}
                >
                  {isSettingDefault ? "Setting…" : "Set as Default"}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                className="border-ember/30 text-ember hover:bg-ember/5 hover:border-ember"
                disabled={isDeleting}
                onClick={() => void handleDelete()}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>

          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <div>
              <Label htmlFor="name">Resume Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="content">Content (Markdown)</Label>
              <textarea
                className="mt-2 min-h-[500px] w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 font-mono text-sm text-ink outline-none transition focus:border-spruce focus:ring-2 focus:ring-spruce/15"
                id="content"
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-4">
              <Button disabled={saveState === "saving"} type="submit">
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "saved"
                    ? "Saved"
                    : "Save Changes"}
              </Button>
              {saveState === "saved" ? (
                <span className="text-sm text-spruce">Your changes have been saved.</span>
              ) : null}
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
