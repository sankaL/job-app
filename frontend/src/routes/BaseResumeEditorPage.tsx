import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";
import { ActionButtons } from "@/components/ui/button-group";
import {
  PageHeader,
  type MobileMenuAction,
} from "@/components/layout/PageHeader";
import {
  ResumeContactSection,
  ResumeSectionWorkbench,
} from "@/components/resume/ResumeSectionWorkbench";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GenerationHandoff,
  type HandoffMode,
} from "@/components/applications/GenerationHandoff";
import { ExportFilenameModal } from "@/components/resume/ExportFilenameModal";
import { ResumePdfInput } from "@/components/resume/ResumePdfInput";
import { validateFilenameTemplate } from "@/lib/exportFilename";
import { ResumeImportProgress } from "@/components/ui/resume-processing";
import { SkeletonSection } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  createBaseResume,
  deleteBaseResume,
  fetchBaseResume,
  setDefaultBaseResume,
  updateBaseResume,
  uploadBaseResume,
  type BaseResumeDetail,
  type ResumeDocument,
} from "@/lib/api";
import {
  documentFromMarkdown,
  emptyResumeDocument,
  renderResumeDocument,
  resumeDocumentError,
} from "@/lib/resume-document";

function editorSnapshot(
  name: string,
  document: ResumeDocument,
  filenameTemplate: string,
): string {
  return JSON.stringify({ name, document, filenameTemplate: filenameTemplate.trim() });
}

export function BaseResumeEditorPage() {
  const { resumeId } = useParams<{ resumeId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { bootstrap } = useAppContext();
  const { toast } = useToast();
  const editorRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const wasUploadingRef = useRef(false);
  const uploadingRef = useRef(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const isNew = !resumeId || resumeId === "new";
  const uploadMode = isNew && searchParams.get("mode") === "upload";
  const [resume, setResume] = useState<BaseResumeDetail | null>(null);
  const [name, setName] = useState("");
  const [filenameTemplate, setFilenameTemplate] = useState("");
  const [filenameModalOpen, setFilenameModalOpen] = useState(false);
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
    setResume(null);
    setUploadFile(null);
    setName("");
    setFilenameTemplate("");
    setEditingName(isNew && !uploadMode);
    setDocument(emptyResumeDocument());
    setError(null);
    setSaved(false);
    setSavedSnapshot("");
    if (isNew || !resumeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    queryClient
      .fetchQuery({
        queryKey: queryKeys.baseResume(resumeId),
        queryFn: () => fetchBaseResume(resumeId),
      })
      .then((response) => {
        if (cancelled) return;
        setResume(response);
        setName(response.name);
        setFilenameTemplate(response.export_filename_template ?? "");
        const nextDocument =
          response.document ?? documentFromMarkdown(response.content_md);
        setDocument(nextDocument);
        setSavedSnapshot(
          editorSnapshot(
            response.name,
            nextDocument,
            response.export_filename_template ?? "",
          ),
        );
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Unable to load resume.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, isNew, uploadMode, queryClient]);

  // Hiding the form during import drops focus to the page body. Once the import ends, move it to
  // the selected section after success or back to the form after failure, unless the user moved it.
  useEffect(() => {
    if (uploading) {
      wasUploadingRef.current = true;
      return;
    }
    if (!wasUploadingRef.current) return;
    wasUploadingRef.current = false;
    const active = window.document.activeElement;
    const focusLost =
      !active ||
      active === window.document.body ||
      !active.isConnected ||
      Boolean(active.closest(".resume-upload-layout"));
    if (!focusLost) return;
    const root = editorRef.current;
    const target = resume
      ? root?.querySelector<HTMLElement>(
          ".resume-index [role='tab'][aria-selected='true']",
        )
      : root?.querySelector<HTMLElement>("#resume-name");
    target?.focus({ preventScroll: true });
  }, [uploading, resume]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function changeDocument(next: ResumeDocument) {
    setDocument(next);
    setSaved(false);
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (uploadingRef.current) return;
    const file = uploadFile;
    if (!file) {
      setError("Please select a PDF file.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setError(null);
    try {
      const response = await uploadBaseResume(
        file,
        name.trim(),
        classify,
        filenameTemplate.trim() || null,
      );
      queryClient.setQueryData(queryKeys.baseResume(response.id), response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.baseResumes });
      setResume(response);
      const nextDocument =
        response.document ?? documentFromMarkdown(response.content_md);
      setName(response.name);
      setFilenameTemplate(response.export_filename_template ?? "");
      setDocument(nextDocument);
      setSavedSnapshot(
        editorSnapshot(
          response.name,
          nextDocument,
          response.export_filename_template ?? "",
        ),
      );
      toast("Resume uploaded. Review each section before tailoring.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to upload resume.",
      );
      toast("Upload failed", "error");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    const filenameError = validateFilenameTemplate(filenameTemplate);
    if (filenameError) {
      setError(filenameError);
      return;
    }
    const documentError = resumeDocumentError(document);
    if (documentError) {
      setError(documentError);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const content = renderResumeDocument(document);
      const response = resume
        ? await updateBaseResume(resume.id, {
            name: name.trim(),
            document,
            export_filename_template: filenameTemplate.trim() || null,
            expected_revision: resume.document?.revision ?? 1,
          })
        : await createBaseResume(
            name.trim(),
            content,
            document,
            filenameTemplate.trim() || null,
          );
      queryClient.setQueryData(queryKeys.baseResume(response.id), response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.baseResumes });
      setResume(response);
      const nextDocument = response.document ?? document;
      setName(response.name);
      setFilenameTemplate(response.export_filename_template ?? "");
      setDocument(nextDocument);
      setSavedSnapshot(
        editorSnapshot(
          response.name,
          nextDocument,
          response.export_filename_template ?? "",
        ),
      );
      setSaved(true);
      setEditingName(false);
      toast("Resume saved");
      if (isNew) navigate(`/app/resumes/${response.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save resume.",
      );
      toast("Failed to save resume", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!resume) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteBaseResume(resume.id);
      navigate("/app/resumes");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to delete resume.",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleDefault() {
    if (!resume) return;
    setSettingDefault(true);
    setError(null);
    try {
      await setDefaultBaseResume(resume.id);
      setResume({ ...resume, is_default: true });
      toast("Default resume updated");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to set default resume.",
      );
    } finally {
      setSettingDefault(false);
    }
  }

  const dirty = savedSnapshot
    ? editorSnapshot(name, document, filenameTemplate) !== savedSnapshot
    : Boolean(name.trim() || document.sections.length);
  const reviewingUpload = uploadMode && Boolean(resume);
  // The import view becomes the page's focus, then hands off to the parsed sections.
  const importHandoffMode: HandoffMode = uploading
    ? "generation"
    : reviewingUpload
      ? "draft"
      : "other";
  const workbenchLayout =
    !loading && (resume || uploading || (!uploadMode && isNew));
  const primaryAction =
    !loading && (resume || (!uploadMode && isNew)) ? (
      <Button
        type="submit"
        form="base-resume-edit-form"
        title={dirty ? "Save unsaved changes" : "Save resume"}
        loading={saving}
        disabled={saving}
      >
        {saving
          ? "Saving…"
          : saved
            ? "Saved"
            : isNew && !resume
              ? "Create Resume"
              : "Save Changes"}
      </Button>
    ) : !loading && isNew && uploadMode && !resume ? (
      <Button
        type="submit"
        form="resume-upload-form"
        disabled={uploading}
      >
        {uploading ? "Import in progress" : "Upload & Parse"}
      </Button>
    ) : null;
  const fileNameMenuAction: MobileMenuAction = {
    label: "File name",
    disabled: saving || uploading,
    onSelect: () => setFilenameModalOpen(true),
  };
  const mobileMenu: MobileMenuAction[] | undefined =
    !loading && isNew && !resume
      ? [fileNameMenuAction]
      : !loading && resume && !isNew
      ? [
          fileNameMenuAction,
          ...(!resume.is_default
            ? [
                {
                  label: settingDefault ? "Setting…" : "Set Default",
                  disabled: settingDefault,
                  onSelect: () => void handleDefault(),
                },
              ]
            : []),
          {
            label: "Delete resume",
            destructive: true,
            disabled: deleting,
            onSelect: () => setConfirmDelete(true),
          },
        ]
      : undefined;
  return (
    <div
      ref={editorRef}
      className={`resume-editor page-enter w-full ${workbenchLayout ? "resume-editor--workbench" : "space-y-5"}`}
    >
      <PageHeader
        hasBodyHeading
        groupActions={false}
        title={resume?.name ?? (uploadMode ? "Upload resume" : "New resume")}
        titleContent={
          editingName ? (
            <>
              <Label className="sr-only" htmlFor="resume-name">
                Resume Name
              </Label>
              <Input
                id="resume-name"
                className="resume-name-input"
                form="base-resume-edit-form"
                autoFocus
                value={name}
                maxLength={200}
                required
                disabled={saving}
                placeholder="Name your resume"
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                  if (event.key === "Escape" && resume) {
                    setName(nameBeforeEdit.current);
                    setEditingName(false);
                  }
                }}
              />
            </>
          ) : undefined
        }
        titleAction={
          !editingName && !loading && (resume || (!uploadMode && isNew)) ? (
            <IconButton
              aria-label="Edit resume name"
              title="Edit resume name"
              className="text-secondary"
              disabled={saving}
              onClick={() => {
                nameBeforeEdit.current = name;
                setEditingName(true);
              }}
            >
              <Pencil size={16} />
            </IconButton>
          ) : undefined
        }
        subtitle={
          resume
            ? `Source resume · revision ${resume.document?.revision ?? 1}`
            : "Build a reviewed source for every tailored resume"
        }
        mobileMenu={mobileMenu}
        mobilePrimary={primaryAction}
        actions={
          !loading && (resume || isNew) ? (
            <ActionButtons
              label={`${resume?.name ?? "Resume"} actions`}
              // Save stays the orange primary action; delete sits after it at the end.
              primaryIndex={resume && !isNew && !resume.is_default ? 2 : 1}
            >
              <Button
                variant="secondary"
                title="Name the files exported from this resume"
                disabled={saving || uploading}
                onClick={() => setFilenameModalOpen(true)}
              >
                <FileText size={14} aria-hidden="true" />
                File Name
              </Button>
              {resume && !isNew && !resume.is_default ? (
                <Button
                  variant="secondary"
                  disabled={settingDefault}
                  onClick={() => void handleDefault()}
                >
                  {settingDefault ? "Setting…" : "Set Default"}
                </Button>
              ) : null}
              {primaryAction}
              {resume && !isNew ? (
                <IconButton
                  variant="danger"
                  aria-label="Delete resume"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} />
                </IconButton>
              ) : null}
            </ActionButtons>
          ) : undefined
        }
      />
      {error &&
        (uploadMode && !resume ? (
          <Text
            as="p"
            display="block"
            type="body"
            role="alert"
            style={{ color: "var(--color-error)" }}
          >
            {error}
          </Text>
        ) : (
          <Section variant="danger">
            <Text as="p" display="block" type="body">
              {error}
            </Text>
            <Text as="p" display="block" type="supporting" className="mt-2">
              Your unsaved edits are still here. If another tab saved this
              resume, reload its latest revision before trying again.
            </Text>
          </Section>
        ))}
      <GenerationHandoff
        mode={importHandoffMode}
        scope={editorRef}
        viewSelector=".resume-import-view"
        regionSelector=".resume-editor-form"
        chromeSelector=".resume-import-warning"
      >
        {loading ? (
          <SkeletonSection />
        ) : !isNew && !resume ? (
          <Section>
            <Text as="p" display="block" type="body">
              This resume could not be loaded.
            </Text>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => navigate("/app/resumes")}
            >
              Back to resumes
            </Button>
          </Section>
        ) : uploadMode && !resume ? (
          <>
            {/* Hidden rather than unmounted while importing, so the chosen file and name survive a failed import. */}
            <div className="resume-upload-layout" hidden={uploading}>
              <form
                id="resume-upload-form"
                className="resume-upload-form"
                aria-busy={uploading}
                onSubmit={handleUpload}
              >
                <ResumePdfInput
                  file={uploadFile}
                  disabled={uploading}
                  onChange={(file) => {
                    setUploadFile(file);
                    setError(null);
                  }}
                  onError={setError}
                />
                <div>
                  <Label htmlFor="resume-name">Resume Name</Label>
                  <Input
                    id="resume-name"
                    value={name}
                    maxLength={200}
                    placeholder="e.g., Senior Engineer Resume"
                    required
                    disabled={uploading}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Input
                    type="checkbox"
                    disabled={uploading}
                    checked={classify}
                    onChange={(event) => setClassify(event.target.checked)}
                  />{" "}
                  Use AI to extract roles, education and their details
                </label>
                <Text
                  as="p"
                  display="block"
                  type="supporting"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Contact information stays local. Unknown or uncertain sections are
                  kept for your review.
                </Text>
              </form>
            </div>
            {uploading && (
              <div className="resume-import-view">
                <ResumeImportProgress useAi={classify} />
              </div>
            )}
          </>
        ) : (
          <form
            id="base-resume-edit-form"
            className="resume-editor-form"
            onSubmit={handleSave}
          >
            {resume?.needs_review && (
              <div className="resume-import-warning">
                <Text as="p" display="block" type="label">
                  Check your import before tailoring
                </Text>
                <Text as="p" display="block" type="body" className="mt-1">
                  {resume.import_warning ??
                    "Check the imported facts and section types."}{" "}
                  Confirm that each job has its own role, employer, dates and
                  bullets.
                </Text>
              </div>
            )}
            <ResumeSectionWorkbench
              key={resumeId ?? "new"}
              document={document}
              onChange={changeDocument}
              source
              disabled={saving}
              contactPanel={
                <ResumeContactSection
                  profile={bootstrap?.profile ?? null}
                  suggestions={resume?.contact_suggestions}
                />
              }
              referencePanel={
                resume?.raw_source_md || reviewingUpload ? (
                  <div>
                    <Heading level={3} className="resume-section-heading">
                      Original extracted text
                    </Heading>
                    <Text
                      as="p"
                      display="block"
                      type="supporting"
                      className="mt-2"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      Check uncertain imports against this text. Add contact
                      details to your profile.
                    </Text>
                    <pre className="mt-4 whitespace-pre-wrap break-words text-sm">
                      {resume?.raw_source_md ||
                        "Original extracted text is unavailable."}
                    </pre>
                    {reviewingUpload && (
                      <Button
                        className="mt-4"
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setResume(null);
                          setUploadFile(null);
                          setEditingName(false);
                          setDocument(emptyResumeDocument());
                          setSavedSnapshot("");
                          setSaved(false);
                        }}
                      >
                        Re-upload
                      </Button>
                    )}
                  </div>
                ) : undefined
              }
            />

          </form>
        )}
      </GenerationHandoff>
      <ExportFilenameModal
        open={filenameModalOpen}
        value={filenameTemplate}
        profile={bootstrap?.profile ?? null}
        applyHint={
          uploadMode && !resume
            ? "It is saved when you upload."
            : isNew && !resume
              ? "It is saved when you create the resume."
              : "Save Changes to keep it."
        }
        onApply={(value) => {
          setFilenameTemplate(value);
          setSaved(false);
        }}
        onClose={() => setFilenameModalOpen(false)}
      />
      <ConfirmModal
        open={confirmDelete}
        title="Delete resume?"
        message={`This will permanently remove "${resume?.name ?? "this resume"}".`}
        confirmLabel="Delete Resume"
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
