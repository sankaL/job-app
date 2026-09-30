import { type FormEvent, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { ResumeContactCard, ResumeSectionWorkbench } from "@/components/resume/ResumeSectionWorkbench";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createBaseResume, deleteBaseResume, fetchBaseResume, setDefaultBaseResume, updateBaseResume, uploadBaseResume, type BaseResumeDetail, type ResumeDocument } from "@/lib/api";
import { documentFromMarkdown, emptyResumeDocument, renderResumeDocument, resumeDocumentError } from "@/lib/resume-document";

export function BaseResumeEditorPage() {
  const { resumeId } = useParams<{ resumeId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { bootstrap } = useAppContext();
  const { toast } = useToast();
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isNew = !resumeId || resumeId === "new";
  const uploadMode = isNew && searchParams.get("mode") === "upload";
  const [resume, setResume] = useState<BaseResumeDetail | null>(null);
  const [name, setName] = useState("");
  const [document, setDocument] = useState<ResumeDocument>(emptyResumeDocument);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [classify, setClassify] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResume(null);
    setName("");
    setDocument(emptyResumeDocument());
    setError(null);
    if (isNew || !resumeId) { setLoading(false); return; }
    setLoading(true);
    fetchBaseResume(resumeId).then((response) => {
      if (cancelled) return;
      setResume(response); setName(response.name);
      setDocument(response.document ?? documentFromMarkdown(response.content_md));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load resume.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resumeId, isNew]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function changeDocument(next: ResumeDocument) { setDocument(next); setSaved(false); }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (uploadingRef.current) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError("Please select a PDF file."); return; }
    if (!name.trim()) { setError("Please enter a name."); return; }
    uploadingRef.current = true;
    setUploading(true); setError(null);
    try {
      const response = await uploadBaseResume(file, name.trim(), classify);
      setResume(response);
      setDocument(response.document ?? documentFromMarkdown(response.content_md));
      toast("Resume uploaded. Review each section before tailoring.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload resume.");
      toast("Upload failed", "error");
    } finally { uploadingRef.current = false; setUploading(false); }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    if (!name.trim()) { setError("Please enter a name."); return; }
    const documentError = resumeDocumentError(document);
    if (documentError) { setError(documentError); return; }
    savingRef.current = true;
    setSaving(true); setError(null);
    try {
      const content = renderResumeDocument(document);
      const response = resume ? await updateBaseResume(resume.id, {
        name: name.trim(), document, expected_revision: resume.document?.revision ?? 1,
      }) : await createBaseResume(name.trim(), content, document);
      setResume(response);
      setDocument(response.document ?? document);
      setSaved(true);
      toast("Resume saved");
      if (isNew) navigate(`/app/resumes/${response.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save resume.");
      toast("Failed to save resume", "error");
    } finally { savingRef.current = false; setSaving(false); }
  }

  async function handleDelete() {
    if (!resume) return;
    setDeleting(true); setError(null);
    try { await deleteBaseResume(resume.id); navigate("/app/resumes"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete resume."); }
    finally { setDeleting(false); }
  }

  async function handleDefault() {
    if (!resume) return;
    setSettingDefault(true); setError(null);
    try { await setDefaultBaseResume(resume.id); setResume({ ...resume, is_default: true }); toast("Default resume updated"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to set default resume."); }
    finally { setSettingDefault(false); }
  }

  const reviewingUpload = uploadMode && Boolean(resume);
  return (
    <div className="page-enter mx-auto max-w-5xl space-y-5">
      <PageHeader title={reviewingUpload ? "Review upload" : resume?.name ?? (uploadMode ? "Upload resume" : "New resume")} subtitle={resume ? `Source resume · revision ${resume.document?.revision ?? 1}` : "Build a reviewed source for every tailored resume"} actions={resume && !isNew ? <div className="flex gap-2">{!resume.is_default && <Button size="sm" variant="secondary" disabled={settingDefault} onClick={() => void handleDefault()}>{settingDefault ? "Setting…" : "Set Default"}</Button>}<IconButton variant="danger" aria-label="Delete resume" disabled={deleting} onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></IconButton></div> : undefined} />
      {error && <Card variant="danger"><p className="text-sm">{error}</p><p className="mt-2 text-xs">Your unsaved edits are still here. If another tab saved this resume, reload its latest revision before trying again.</p></Card>}
      {loading ? <SkeletonCard /> : !isNew && !resume ? <Card><p className="text-sm">This resume could not be loaded.</p><Button className="mt-3" variant="secondary" onClick={() => navigate("/app/resumes")}>Back to resumes</Button></Card> : uploadMode && !resume ? (
        <Card><form className="space-y-4" onSubmit={handleUpload}>
          <div><Label htmlFor="resume-name">Resume Name</Label><Input id="resume-name" value={name} placeholder="e.g., Senior Engineer Resume" required onChange={(event) => setName(event.target.value)} /></div>
          <div><Label htmlFor="resume-file">PDF File</Label><input id="resume-file" ref={fileInputRef} accept=".pdf,application/pdf" className="mt-2 block w-full text-sm" type="file" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={classify} onChange={(event) => setClassify(event.target.checked)} /> Use AI to classify and extract sections</label>
          <p className="text-xs" style={{ color: "var(--color-ink-65)" }}>Contact information stays local. Unknown or uncertain sections are kept for your review.</p>
          <Button type="submit" loading={uploading}>{uploading ? "Extracting and classifying sections…" : "Upload & Parse"}</Button>
        </form></Card>
      ) : (
        <form className="space-y-5" onSubmit={handleSave}>
          {resume?.needs_review && <Card variant="warning"><p className="text-sm font-semibold">Review recommended</p><p className="mt-1 text-sm">{resume.import_warning ?? "Check the imported facts and section types."}</p></Card>}
          <Card><Label htmlFor="resume-name">Resume Name</Label><Input id="resume-name" value={name} required disabled={saving} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></Card>
          <ResumeContactCard profile={bootstrap?.profile ?? null} suggestions={resume?.contact_suggestions} />
          {resume?.raw_source_md && <details className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}><summary className="cursor-pointer text-xs font-semibold">Original extracted text</summary><p className="mt-2 text-xs" style={{ color: "var(--color-ink-65)" }}>Use this to check an uncertain import. Add any contact details to your profile.</p><pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs">{resume.raw_source_md}</pre></details>}
          {reviewingUpload && <Button type="button" variant="secondary" onClick={() => { setResume(null); setDocument(emptyResumeDocument()); }}>Re-upload</Button>}
          <ResumeSectionWorkbench document={document} onChange={changeDocument} source disabled={saving} />
          <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-sm" style={{ background: "var(--color-white)", borderColor: "var(--color-border)" }}>
            <p className="text-xs" style={{ color: "var(--color-ink-65)" }}>Changes apply to future generations. Existing drafts keep their source revision.</p>
            <Button type="submit" loading={saving} disabled={saving}>{saving ? "Saving…" : saved ? "Saved" : isNew && !resume ? "Create Resume" : "Save Changes"}</Button>
          </div>
        </form>
      )}
      <ConfirmModal open={confirmDelete} title="Delete resume?" message={`This will permanently remove "${resume?.name ?? "this resume"}".`} confirmLabel="Delete Resume" variant="danger" loading={deleting} onConfirm={() => void handleDelete()} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
