import { type FormEvent, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
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

function ResumeContentFields({
  name,
  content,
  onNameChange,
  onContentChange,
  namePlaceholder,
  contentPlaceholder,
  nameRequired = false,
}: {
  name: string;
  content: string;
  onNameChange: (value: string) => void;
  onContentChange: (value: string) => void;
  namePlaceholder?: string;
  contentPlaceholder?: string;
  nameRequired?: boolean;
}) {
  return (
    <>
      <div>
        <Label htmlFor="name">Resume Name</Label>
        <Input
          id="name"
          placeholder={namePlaceholder}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          required={nameRequired}
        />
      </div>
      <div>
        <Label htmlFor="content">Content (Markdown)</Label>
        <MarkdownEditor
          id="content"
          className="no-bottom-radius min-h-[50vh]"
          placeholder={contentPlaceholder}
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
        />
        <div className="markdown-editor-footer">
          <span>Markdown · {content.length.toLocaleString()} characters</span>
          <span>Tab = 2 spaces</span>
        </div>
      </div>
    </>
  );
}

function ResumeError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Card variant="danger">
      <p
        className="text-sm font-semibold"
        style={{ color: "var(--color-ember)" }}
      >
        Error
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
        {error}
      </p>
    </Card>
  );
}

function UploadResumeForm({
  name,
  cleanup,
  uploading,
  fileInputRef,
  onNameChange,
  onCleanupChange,
  onSubmit,
}: {
  name: string;
  cleanup: boolean;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onNameChange: (value: string) => void;
  onCleanupChange: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Card>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="name">Resume Name</Label>
          <Input
            id="name"
            placeholder="e.g., Senior Engineer Resume"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="file">PDF File</Label>
          <input
            ref={fileInputRef}
            accept=".pdf,application/pdf"
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
            style={{ color: "var(--color-ink)" }}
            id="file"
            type="file"
          />
          <p className="mt-1 text-xs" style={{ color: "var(--color-ink-40)" }}>
            PDF files only.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            checked={cleanup}
            type="checkbox"
            onChange={(event) => onCleanupChange(event.target.checked)}
            style={{ accentColor: "var(--color-spruce)" }}
          />
          Improve with AI (sanitized)
        </label>
        <p className="text-xs" style={{ color: "var(--color-ink-40)" }}>
          AI cleanup removes contact info before external processing, improves
          formatting, restores header locally.
        </p>
        <Button loading={uploading} disabled={uploading} type="submit">
          {uploading ? "Uploading…" : "Upload & Parse"}
        </Button>
      </form>
    </Card>
  );
}

function UploadedResumeReview({
  resume,
  name,
  content,
  saveState,
  onNameChange,
  onContentChange,
  onSave,
  onReset,
}: {
  resume: BaseResumeDetail;
  name: string;
  content: string;
  saveState: SaveState;
  onNameChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <>
      {resume.needs_review && (
        <Card variant="warning">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-amber)" }}
          >
            Review recommended
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
            {resume.import_warning ?? "This upload may need manual cleanup."}
          </p>
        </Card>
      )}
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <ResumeContentFields
            name={name}
            content={content}
            onNameChange={onNameChange}
            onContentChange={onContentChange}
          />
          <div className="flex gap-2">
            <Button
              loading={saveState === "saving"}
              disabled={saveState === "saving"}
              type="submit"
            >
              {saveState === "saving" ? "Saving…" : "Save Resume"}
            </Button>
            <Button type="button" variant="secondary" onClick={onReset}>
              Re-upload
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

function NewUploadResumePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploaded, setUploaded] = useState<BaseResumeDetail | null>(null);
  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please select a PDF file.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const response = await uploadBaseResume(file, name, cleanup);
      setUploaded(response);
      setContent(response.content_md);
      toast("Resume uploaded and parsed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to upload.");
      toast("Upload failed", "error");
    } finally {
      setUploading(false);
    }
  };
  const handleSave = async () => {
    if (!uploaded) return;
    setSaveState("saving");
    setError(null);
    try {
      const response = await updateBaseResume(uploaded.id, {
        name,
        content_md: content,
      });
      toast("Resume saved");
      navigate(`/app/resumes/${response.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save.");
      toast("Failed to save resume", "error");
      setSaveState("idle");
    }
  };
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title={uploaded ? "Review Upload" : "Upload Resume"}
        subtitle={
          uploaded ? name : "Upload an existing resume PDF for extraction"
        }
      />
      <ResumeError error={error} />
      {uploaded ? (
        <UploadedResumeReview
          resume={uploaded}
          name={name}
          content={content}
          saveState={saveState}
          onNameChange={setName}
          onContentChange={setContent}
          onSave={() => void handleSave()}
          onReset={() => setUploaded(null)}
        />
      ) : (
        <UploadResumeForm
          name={name}
          cleanup={cleanup}
          uploading={uploading}
          fileInputRef={fileInputRef}
          onNameChange={setName}
          onCleanupChange={setCleanup}
          onSubmit={handleUpload}
        />
      )}
    </div>
  );
}

function NewBlankResumePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await createBaseResume(name, content);
      toast("Resume created");
      navigate(`/app/resumes/${response.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create.");
      toast("Failed to create resume", "error");
      setSaving(false);
    }
  };
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="New Resume"
        subtitle="Create from scratch using Markdown"
      />
      <ResumeError error={error} />
      <Card>
        <form className="space-y-4" onSubmit={handleCreate}>
          <ResumeContentFields
            name={name}
            content={content}
            onNameChange={setName}
            onContentChange={setContent}
            namePlaceholder="e.g., Senior Engineer Resume"
            contentPlaceholder={
              "# Your Name\n\n## Summary\nProfessional summary…\n\n## Experience\n\n### Job Title — Company\n- Accomplishment 1\n- Accomplishment 2\n\n## Skills\n- Skill 1\n- Skill 2"
            }
            nameRequired
          />
          <Button loading={saving} disabled={saving} type="submit">
            {saving ? "Creating…" : "Create Resume"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function ExistingResumeHeader({
  resume,
  settingDefault,
  deleting,
  onSetDefault,
  onDelete,
}: {
  resume: BaseResumeDetail;
  settingDefault: boolean;
  deleting: boolean;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const badge = resume.is_default ? (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
      style={{
        background: "var(--color-spruce-10)",
        color: "var(--color-spruce)",
      }}
    >
      Default
    </span>
  ) : undefined;
  return (
    <PageHeader
      title={resume.name}
      subtitle={`Created ${new Date(resume.created_at).toLocaleDateString()} · Updated ${new Date(resume.updated_at).toLocaleString()}`}
      badge={badge}
      actions={
        <div className="flex gap-2">
          {!resume.is_default && (
            <Button
              size="sm"
              variant="secondary"
              disabled={settingDefault}
              onClick={onSetDefault}
            >
              {settingDefault ? "Setting…" : "Set Default"}
            </Button>
          )}
          <IconButton
            variant="danger"
            aria-label="Delete resume"
            title="Delete resume"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        </div>
      }
    />
  );
}

function ResumeSaveControls({ state }: { state: SaveState }) {
  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : "Save Changes";
  return (
    <div className="flex items-center gap-3">
      <Button
        loading={state === "saving"}
        disabled={state === "saving"}
        type="submit"
      >
        {label}
      </Button>
      {state === "saved" && (
        <span className="text-xs" style={{ color: "var(--color-spruce)" }}>
          Changes saved.
        </span>
      )}
    </div>
  );
}

function LoadedResumeEditor({
  resume,
  name,
  content,
  saveState,
  deleting,
  settingDefault,
  confirmDelete,
  onNameChange,
  onContentChange,
  onSave,
  onSetDefault,
  onOpenDelete,
  onConfirmDelete,
  onCloseDelete,
}: Omit<ExistingResumeViewProps, "resume" | "error"> & {
  resume: BaseResumeDetail;
}) {
  return (
    <>
      <ExistingResumeHeader
        resume={resume}
        settingDefault={settingDefault}
        deleting={deleting}
        onSetDefault={onSetDefault}
        onDelete={onOpenDelete}
      />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <ResumeContentFields
            name={name}
            content={content}
            onNameChange={onNameChange}
            onContentChange={onContentChange}
          />
          <ResumeSaveControls state={saveState} />
        </form>
      </Card>
      <ConfirmModal
        open={confirmDelete}
        title="Delete resume?"
        message={`This will permanently remove "${resume.name}". This action cannot be undone.`}
        confirmLabel="Delete Resume"
        variant="danger"
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={onCloseDelete}
      />
    </>
  );
}

type ExistingResumeViewProps = {
  resume: BaseResumeDetail | null;
  error: string | null;
  name: string;
  content: string;
  saveState: SaveState;
  deleting: boolean;
  settingDefault: boolean;
  confirmDelete: boolean;
  onNameChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onSetDefault: () => void;
  onOpenDelete: () => void;
  onConfirmDelete: () => void;
  onCloseDelete: () => void;
};

function ExistingResumeView(props: ExistingResumeViewProps) {
  if (!props.resume)
    return (
      <div className="page-enter space-y-5">
        <ResumeError error={props.error} />
        <SkeletonCard />
      </div>
    );
  return (
    <div className="page-enter space-y-5">
      <ResumeError error={props.error} />
      <LoadedResumeEditor {...props} resume={props.resume} />
    </div>
  );
}

function ExistingResumeEditorPage({ resumeId }: { resumeId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [resume, setResume] = useState<BaseResumeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    fetchBaseResume(resumeId)
      .then((response) => {
        setResume(response);
        setName(response.name);
        setContent(response.content_md);
        setError(null);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [resumeId]);
  useEffect(() => {
    if (saveState !== "saved") return;
    const timeoutId = window.setTimeout(() => setSaveState("idle"), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [saveState]);
  const handleSave = async () => {
    setSaveState("saving");
    setError(null);
    try {
      const response = await updateBaseResume(resumeId, {
        name,
        content_md: content,
      });
      setResume(response);
      setSaveState("saved");
      toast("Resume saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save.");
      setSaveState("idle");
    }
  };
  const handleDelete = async () => {
    if (!resume) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteBaseResume(resume.id);
      setConfirmDelete(false);
      navigate("/app/resumes");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  };
  const handleSetDefault = async () => {
    if (!resume) return;
    setSettingDefault(true);
    setError(null);
    try {
      await setDefaultBaseResume(resume.id);
      setResume({ ...resume, is_default: true });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to set default.",
      );
    } finally {
      setSettingDefault(false);
    }
  };
  return (
    <ExistingResumeView
      resume={resume}
      error={error}
      name={name}
      content={content}
      saveState={saveState}
      deleting={deleting}
      settingDefault={settingDefault}
      confirmDelete={confirmDelete}
      onNameChange={setName}
      onContentChange={setContent}
      onSave={() => void handleSave()}
      onSetDefault={() => void handleSetDefault()}
      onOpenDelete={() => setConfirmDelete(true)}
      onConfirmDelete={() => void handleDelete()}
      onCloseDelete={() => {
        if (!deleting) setConfirmDelete(false);
      }}
    />
  );
}

export function BaseResumeEditorPage() {
  const { resumeId } = useParams<{ resumeId: string }>();
  const [searchParams] = useSearchParams();
  const isNew = !resumeId || resumeId === "new";
  const mode = searchParams.get("mode");
  if (isNew && mode === "upload") return <NewUploadResumePage />;
  if (isNew && mode === "blank") return <NewBlankResumePage />;
  return resumeId ? (
    <ExistingResumeEditorPage resumeId={resumeId} />
  ) : (
    <div className="page-enter space-y-5">
      <SkeletonCard />
    </div>
  );
}
