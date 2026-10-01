import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries";
import { Pencil, Trash2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { ResumeContactSection, ResumeSectionWorkbench } from "@/components/resume/ResumeSectionWorkbench";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResumePdfInput } from "@/components/resume/ResumePdfInput";
import { ResumeImportProgress } from "@/components/ui/resume-processing";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createBaseResume, deleteBaseResume, fetchBaseResume, setDefaultBaseResume, updateBaseResume, uploadBaseResume, type BaseResumeDetail, type ResumeDocument } from "@/lib/api";
import { documentFromMarkdown, emptyResumeDocument, hasSectionContent, renderResumeDocument, resumeDocumentError } from "@/lib/resume-document";

export function BaseResumeEditorPage() {
  const { resumeId } = useParams<{ resumeId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { bootstrap } = useAppContext();
  const { toast } = useToast();
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const isNew = !resumeId || resumeId === "new";
  const uploadMode = isNew && searchParams.get("mode") === "upload";
  const [resume, setResume] = useState<BaseResumeDetail | null>(null);
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const nameBeforeEdit = useRef("");
  const [document, setDocument] = useState<ResumeDocument>(emptyResumeDocument);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [uploading, setUploading] = useState(false);
  const [classify, setClassify] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResume(null); setUploadFile(null);
    setName(""); setEditingName(isNew && !uploadMode);
    setDocument(emptyResumeDocument());
    setError(null); setSaved(false); setSavedSnapshot("");
    if (isNew || !resumeId) { setLoading(false); return; }
    setLoading(true);
    queryClient.fetchQuery({ queryKey: queryKeys.baseResume(resumeId), queryFn: () => fetchBaseResume(resumeId) }).then((response) => {
      if (cancelled) return;
      setResume(response); setName(response.name);
      const nextDocument = response.document ?? documentFromMarkdown(response.content_md);
      setDocument(nextDocument);
      setSavedSnapshot(JSON.stringify({ name: response.name, document: nextDocument }));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load resume.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resumeId, isNew, uploadMode, queryClient]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function changeDocument(next: ResumeDocument) { setDocument(next); setSaved(false); }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (uploadingRef.current) return;
    const file = uploadFile;
    if (!file) { setError("Please select a PDF file."); return; }
    if (!name.trim()) { setError("Please enter a name."); return; }
    uploadingRef.current = true;
    setUploading(true); setError(null);
    try {
      const response = await uploadBaseResume(file, name.trim(), classify);
      queryClient.setQueryData(queryKeys.baseResume(response.id), response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.baseResumes });
      setResume(response);
      const nextDocument = response.document ?? documentFromMarkdown(response.content_md);
      setName(response.name); setDocument(nextDocument);
      setSavedSnapshot(JSON.stringify({ name: response.name, document: nextDocument }));
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
      queryClient.setQueryData(queryKeys.baseResume(response.id), response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.baseResumes });
      setResume(response);
      const nextDocument = response.document ?? document;
      setName(response.name); setDocument(nextDocument);
      setSavedSnapshot(JSON.stringify({ name: response.name, document: nextDocument }));
      setSaved(true); setEditingName(false);
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

  const dirty = savedSnapshot ? JSON.stringify({ name, document }) !== savedSnapshot : Boolean(name.trim() || document.sections.length);
  const included = document.sections.filter((section) => section.enabled && hasSectionContent(section));
  const pendingReview = included.filter((section) => section.review_state !== "reviewed").length;
  const reviewingUpload = uploadMode && Boolean(resume);
  return (
    <div className={`resume-editor page-enter w-full ${!loading && (resume || !uploadMode && isNew) ? "resume-editor--workbench" : "space-y-5"}`}>
      <PageHeader title={resume?.name ?? (uploadMode ? "Upload resume" : "New resume")} titleContent={editingName ? <><Label className="sr-only" htmlFor="resume-name">Resume Name</Label><Input id="resume-name" className="resume-name-input" form="base-resume-edit-form" autoFocus value={name} maxLength={200} required disabled={saving} placeholder="Name your resume" onChange={(event) => { setName(event.target.value); setSaved(false); }} onKeyDown={(event) => { if (event.key === "Escape" && resume) { setName(nameBeforeEdit.current); setEditingName(false); } }} /></> : undefined} titleAction={!editingName && !loading && (resume || !uploadMode && isNew) ? <IconButton aria-label="Edit resume name" disabled={saving} onClick={() => { nameBeforeEdit.current = name; setEditingName(true); }}><Pencil size={16} /></IconButton> : undefined} subtitle={resume ? `Source resume · revision ${resume.document?.revision ?? 1}` : "Build a reviewed source for every tailored resume"} actions={resume && !isNew ? <div className="flex gap-2">{!resume.is_default && <Button size="sm" variant="secondary" disabled={settingDefault} onClick={() => void handleDefault()}>{settingDefault ? "Setting…" : "Set Default"}</Button>}<IconButton variant="danger" aria-label="Delete resume" disabled={deleting} onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></IconButton></div> : undefined} />
      {error && (uploadMode && !resume ? <p role="alert" className="text-sm" style={{ color: "var(--color-ember)" }}>{error}</p> : <Card variant="danger"><p className="text-sm">{error}</p><p className="mt-2 text-xs">Your unsaved edits are still here. If another tab saved this resume, reload its latest revision before trying again.</p></Card>)}
      {loading ? <SkeletonCard /> : !isNew && !resume ? <Card><p className="text-sm">This resume could not be loaded.</p><Button className="mt-3" variant="secondary" onClick={() => navigate("/app/resumes")}>Back to resumes</Button></Card> : uploadMode && !resume ? (
        <div className="resume-upload-layout">
          <form className="resume-upload-form" aria-busy={uploading} onSubmit={handleUpload}>
            <ResumePdfInput file={uploadFile} disabled={uploading} onChange={(file) => { setUploadFile(file); setError(null); }} onError={setError} />
            <div><Label htmlFor="resume-name">Resume Name</Label><Input id="resume-name" value={name} maxLength={200} placeholder="e.g., Senior Engineer Resume" required disabled={uploading} onChange={(event) => setName(event.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={uploading} checked={classify} onChange={(event) => setClassify(event.target.checked)} /> Use AI to extract roles, education and their details</label>
            <p className="text-xs" style={{ color: "var(--color-ink-65)" }}>Contact information stays local. Unknown or uncertain sections are kept for your review.</p>
            <Button type="submit" disabled={uploading}>{uploading ? "Import in progress" : "Upload & Parse"}</Button>
          </form>
          {uploading && <ResumeImportProgress useAi={classify} />}
        </div>
      ) : (
        <form id="base-resume-edit-form" className="resume-editor-form" onSubmit={handleSave}>
          {resume?.needs_review && <div className="resume-import-warning"><p className="font-semibold">Check your import before tailoring</p><p className="mt-1">{resume.import_warning ?? "Check the imported facts and section types."} Confirm that each job has its own role, employer, dates and bullets.</p></div>}
          <ResumeSectionWorkbench key={resumeId ?? "new"} document={document} onChange={changeDocument} source disabled={saving}
            contactPanel={<ResumeContactSection profile={bootstrap?.profile ?? null} suggestions={resume?.contact_suggestions} />}
            referencePanel={resume?.raw_source_md || reviewingUpload ? <div><h3 className="resume-section-heading">Original extracted text</h3><p className="mt-2 text-xs" style={{ color: "var(--color-ink-65)" }}>Check uncertain imports against this text. Add contact details to your profile.</p><pre className="mt-4 whitespace-pre-wrap break-words text-sm">{resume?.raw_source_md || "Original extracted text is unavailable."}</pre>{reviewingUpload && <Button className="mt-4" type="button" variant="secondary" onClick={() => { setResume(null); setUploadFile(null); setEditingName(false); setDocument(emptyResumeDocument()); setSavedSnapshot(""); setSaved(false); }}>Re-upload</Button>}</div> : undefined}
          />
          <div className="resume-save-bar">
            <div><p role="status" className="text-sm font-semibold">{saving ? "Saving your edits…" : dirty ? "Unsaved changes" : !resume ? "Not saved yet" : saved ? "Changes saved" : "All changes saved"}</p><p className="mt-1 text-xs" style={{ color: "var(--color-ink-65)" }}>{pendingReview ? `${pendingReview} ${pendingReview === 1 ? "section needs" : "sections need"} review before tailoring` : included.length ? "Included sections reviewed" : "Add content to start review"}</p><p className="resume-save-hint mt-1 text-xs" style={{ color: "var(--color-ink-65)" }}>Changes apply to future generations. Existing drafts keep their source revision.</p></div>
            <Button type="submit" form="base-resume-edit-form" loading={saving} disabled={saving}>{saving ? "Saving…" : saved ? "Saved" : isNew && !resume ? "Create Resume" : "Save Changes"}</Button>
          </div>
        </form>
      )}
      <ConfirmModal open={confirmDelete} title="Delete resume?" message={`This will permanently remove "${resume?.name ?? "this resume"}".`} confirmLabel="Delete Resume" variant="danger" loading={deleting} onConfirm={() => void handleDelete()} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
