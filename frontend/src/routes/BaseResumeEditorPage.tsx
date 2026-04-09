import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
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
  const { toast } = useToast();

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

  useEffect(() => {
    if (isNew || !resumeId) return;
    fetchBaseResume(resumeId)
      .then((response) => { setResume(response); setName(response.name); setContentMd(response.content_md); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [isNew, resumeId]);

  async function handleSave() {
    if (!resumeId || isNew) return;
    setSaveState("saving");
    setError(null);
    try {
      const response = await updateBaseResume(resumeId, { name, content_md: contentMd });
      setResume(response);
      setSaveState("saved");
      toast("Resume saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      setSaveState("idle");
    }
  }

  async function handleCreateBlank(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Please enter a name."); return; }
    setSaveState("saving");
    setError(null);
    try {
      const response = await createBaseResume(name, contentMd);
      toast("Resume created");
      navigate(`/app/resumes/${response.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create.");
      toast("Failed to create resume", "error");
      setSaveState("idle");
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError("Please select a PDF file."); return; }
    if (!name.trim()) { setError("Please enter a name."); return; }
    setIsUploading(true);
    setError(null);
    try {
      const response = await uploadBaseResume(file, name, useLlmCleanup);
      setUploadedResume(response);
      setContentMd(response.content_md);
      toast("Resume uploaded and parsed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload.");
      toast("Upload failed", "error");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSaveUploaded() {
    if (!uploadedResume) return;
    setSaveState("saving");
    setError(null);
    try {
      const response = await updateBaseResume(uploadedResume.id, { name, content_md: contentMd });
      toast("Resume saved");
      navigate(`/app/resumes/${response.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      toast("Failed to save resume", "error");
      setSaveState("idle");
    }
  }

  async function handleDelete() {
    if (!resume) return;
    const confirmed = window.confirm(`Delete "${resume.name}"? This cannot be undone.`);
    if (!confirmed) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteBaseResume(resume.id);
      navigate("/app/resumes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
      setIsDeleting(false);
    }
  }

  async function handleSetDefault() {
    if (!resume) return;
    setIsSettingDefault(true);
    setError(null);
    try {
      await setDefaultBaseResume(resume.id);
      setResume({ ...resume, is_default: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default.");
    } finally {
      setIsSettingDefault(false);
    }
  }

  const errorBanner = error ? (
    <Card variant="danger">
      <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Error</p>
      <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{error}</p>
    </Card>
  ) : null;

  // Upload mode (new)
  if (isNew && mode === "upload" && !uploadedResume) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader title="Upload Resume" subtitle="Upload an existing resume PDF for extraction" />
        {errorBanner}
        <Card>
          <form className="space-y-4" onSubmit={handleUpload}>
            <div>
              <Label htmlFor="name">Resume Name</Label>
              <Input id="name" placeholder="e.g., Senior Engineer Resume" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="file">PDF File</Label>
              <input ref={fileInputRef} accept=".pdf,application/pdf" className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-semibold" style={{ color: "var(--color-ink)" }} id="file" type="file" />
              <p className="mt-1 text-xs" style={{ color: "var(--color-ink-40)" }}>PDF files only.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input checked={useLlmCleanup} type="checkbox" onChange={(e) => setUseLlmCleanup(e.target.checked)} style={{ accentColor: "var(--color-spruce)" }} />
              Improve with AI (sanitized)
            </label>
            <p className="text-xs" style={{ color: "var(--color-ink-40)" }}>AI cleanup removes contact info before external processing, improves formatting, restores header locally.</p>
            <Button loading={isUploading} disabled={isUploading} type="submit">
              {isUploading ? "Uploading…" : "Upload & Parse"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // Upload review mode
  if (isNew && mode === "upload" && uploadedResume) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader title="Review Upload" subtitle={name} />
        {errorBanner}
        {uploadedResume.needs_review && (
          <Card variant="warning">
            <p className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>Review recommended</p>
            <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{uploadedResume.import_warning ?? "This upload may need manual cleanup."}</p>
          </Card>
        )}
        <Card>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSaveUploaded(); }}>
            <div>
              <Label htmlFor="name">Resume Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="content">Content (Markdown)</Label>
              <textarea
                id="content"
                className="markdown-editor no-bottom-radius min-h-[500px]"
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
              />
              <div className="markdown-editor-footer">
                <span>Markdown · {contentMd.length.toLocaleString()} characters</span>
                <span>Tab = 2 spaces</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button loading={saveState === "saving"} disabled={saveState === "saving"} type="submit">
                {saveState === "saving" ? "Saving…" : "Save Resume"}
              </Button>
              <Button variant="secondary" onClick={() => setUploadedResume(null)}>Re-upload</Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  // Blank mode (new)
  if (isNew && mode === "blank") {
    return (
      <div className="page-enter space-y-5">
        <PageHeader title="New Resume" subtitle="Create from scratch using Markdown" />
        {errorBanner}
        <Card>
          <form className="space-y-4" onSubmit={handleCreateBlank}>
            <div>
              <Label htmlFor="name">Resume Name</Label>
              <Input id="name" placeholder="e.g., Senior Engineer Resume" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="content">Content (Markdown)</Label>
              <textarea
                id="content"
                className="markdown-editor no-bottom-radius min-h-[500px]"
                placeholder={"# Your Name\n\n## Summary\nProfessional summary…\n\n## Experience\n\n### Job Title — Company\n- Accomplishment 1\n- Accomplishment 2\n\n## Skills\n- Skill 1\n- Skill 2"}
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
              />
              <div className="markdown-editor-footer">
                <span>Markdown · {contentMd.length.toLocaleString()} characters</span>
                <span>Tab = 2 spaces</span>
              </div>
            </div>
            <Button loading={saveState === "saving"} disabled={saveState === "saving"} type="submit">
              {saveState === "saving" ? "Creating…" : "Create Resume"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // Existing resume editor
  return (
    <div className="page-enter space-y-5">
      {errorBanner}
      {!resume ? (
        <SkeletonCard />
      ) : (
        <>
          <PageHeader
            title={resume.name}
            subtitle={`Created ${new Date(resume.created_at).toLocaleDateString()} · Updated ${new Date(resume.updated_at).toLocaleString()}`}
            badge={
              resume.is_default ? (
                <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: "var(--color-spruce-10)", color: "var(--color-spruce)" }}>
                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                  Default
                </span>
              ) : undefined
            }
            actions={
              <div className="flex gap-2">
                {!resume.is_default && (
                  <Button size="sm" variant="secondary" disabled={isSettingDefault} onClick={() => void handleSetDefault()}>
                    {isSettingDefault ? "Setting…" : "Set Default"}
                  </Button>
                )}
                <Button size="sm" variant="danger" disabled={isDeleting} onClick={() => void handleDelete()}>
                  {isDeleting ? "Deleting…" : "Delete"}
                </Button>
              </div>
            }
          />

          <Card>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
              <div>
                <Label htmlFor="name">Resume Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="content">Content (Markdown)</Label>
                <textarea
                  id="content"
                  className="markdown-editor no-bottom-radius min-h-[500px]"
                  value={contentMd}
                  onChange={(e) => setContentMd(e.target.value)}
                />
                <div className="markdown-editor-footer">
                  <span>Markdown · {contentMd.length.toLocaleString()} characters</span>
                  <span>Tab = 2 spaces</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button loading={saveState === "saving"} disabled={saveState === "saving"} type="submit">
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save Changes"}
                </Button>
                {saveState === "saved" && <span className="text-xs" style={{ color: "var(--color-spruce)" }}>Changes saved.</span>}
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
