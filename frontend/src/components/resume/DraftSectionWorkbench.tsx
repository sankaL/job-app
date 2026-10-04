import { ActionButtons } from "@/components/ui/button-group";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import {
  ResumeContactSection,
  ResumeSectionWorkbench,
  type SectionProcessing,
} from "./ResumeSectionWorkbench";
import type {
  ProfileData,
  ResumeDocument,
  ResumeDraft,
  ResumeSection,
} from "@/lib/api";
import {
  documentFromMarkdown,
  resumeDocumentError,
} from "@/lib/resume-document";

export function DraftSectionWorkbench({
  draft,
  profile,
  locked = false,
  saving = false,
  onSave,
  onRegenerate,
  onDirtyChange,
  canRegenerate,
  regenerationReason,
  processing,
}: {
  draft: ResumeDraft;
  profile: ProfileData | null;
  locked?: boolean;
  processing?: SectionProcessing;
  saving?: boolean;
  onSave: (
    document: ResumeDocument,
    expectedRevision: number,
  ) => Promise<boolean>;
  onRegenerate: (section: ResumeSection, entryId?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  canRegenerate?: (section: ResumeSection, entryId?: string) => boolean;
  regenerationReason?: (
    section: ResumeSection,
    entryId?: string,
  ) => string | null;
}) {
  const [document, setDocument] = useState(
    () => draft.document ?? documentFromMarkdown(draft.content_md),
  );
  const processingSection = processing?.sectionId
    ? document.sections.find((section) => section.id === processing.sectionId || section.kind === processing.sectionId)
    : undefined;
  const inlineProcessing = processing && { ...processing, sectionId: processingSection?.id };
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const saveInFlightRef = useRef(false);
  const revisionRef = useRef(draft.document?.revision ?? 1);
  const signatureRef = useRef(
    `${draft.id}:${draft.updated_at}:${draft.document?.revision ?? 1}`,
  );
  const currentSignature = `${draft.id}:${draft.updated_at}:${draft.document?.revision ?? 1}`;
  useEffect(() => {
    if (signatureRef.current === currentSignature) return;
    if (dirty) {
      setChangedElsewhere(true);
      return;
    }
    signatureRef.current = currentSignature;
    revisionRef.current = draft.document?.revision ?? 1;
    setDocument(draft.document ?? documentFromMarkdown(draft.content_md));
    setChangedElsewhere(false);
  }, [currentSignature, draft, dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  function discardChanges() {
    signatureRef.current = currentSignature;
    revisionRef.current = draft.document?.revision ?? 1;
    setDocument(draft.document ?? documentFromMarkdown(draft.content_md));
    setDirty(false);
    setChangedElsewhere(false);
  }

  async function saveChanges() {
    if (saveInFlightRef.current) return;
    const documentError = resumeDocumentError(document);
    if (documentError) {
      setError(documentError);
      return;
    }
    setError(null);
    saveInFlightRef.current = true;
    try {
      if (await onSave(document, revisionRef.current)) setDirty(false);
    } finally {
      saveInFlightRef.current = false;
    }
  }

  return (
    <div
      className="draft-workbench flex min-h-0 flex-1 flex-col"
      data-testid="draft-section-workbench"
    >
      {error && (
        <Text
          as="p"
          display="block"
          type="supporting"
          role="alert"
          className="mt-3"
          style={{ color: "var(--color-error)" }}
        >
          {error}
        </Text>
      )}
      {changedElsewhere && (
        <Section variant="warning" className="mt-3">
          <Text as="p" display="block" type="supporting">
            A newer draft is available. Your unsaved edits are preserved here.
            Reload the latest draft before saving.
          </Text>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={locked || saving}
            onClick={discardChanges}
          >
            Reload latest draft
          </Button>
        </Section>
      )}
      <div className="draft-workbench-content flex min-h-0 flex-1 flex-col gap-4 py-4">
        {!draft.document && (
          <Text
            as="p"
            display="block"
            type="supporting"
            style={{ color: "var(--color-text-secondary)" }}
          >
            This legacy draft will gain section IDs when you save it. To refresh
            source links, choose Use latest base resume during full
            regeneration.
          </Text>
        )}
        {inlineProcessing && !inlineProcessing.sectionId && inlineProcessing.content}
        <ResumeSectionWorkbench
          contactPanel={<ResumeContactSection profile={profile} />}
          document={document}
          processing={inlineProcessing}
          disabled={locked || saving}
          onChange={(next) => {
            setDocument(next);
            setDirty(true);
          }}
          onRegenerate={!dirty && draft.document ? onRegenerate : undefined}
          canRegenerate={canRegenerate}
          regenerationReason={regenerationReason}
        />
      </div>
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <Text
          as="p"
          display="block"
          type="supporting"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {dirty
            ? "Unsaved changes. Save before regenerating or exporting."
            : "All changes saved"}
        </Text>
        {dirty && (
          <div className="flex gap-2">
            <ActionButtons label="Draft changes" size="sm">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={locked || saving}
                onClick={discardChanges}
              >
                Discard edits
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={locked || saving || changedElsewhere}
                loading={saving}
                onClick={() => void saveChanges()}
              >
                {saving ? "Saving…" : "Save Draft"}
              </Button>

            </ActionButtons>
</div>
        )}
      </div>
    </div>
  );
}
