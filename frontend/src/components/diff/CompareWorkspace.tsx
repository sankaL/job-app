import { ActionButtons } from "@/components/ui/button-group";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { useMemo, useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { BaseResumeDetail, ResumeDraft } from "@/lib/api";
import { parseResume, parseResumeDocument } from "./resume-parser";
import { compareResumeDocs, type DiffHighlightMode } from "./diff-engine";
import { CompareHeroBar } from "./CompareHeroBar";
import { CompareSectionNav } from "./CompareSectionNav";
import { SectionDiffCard } from "./SectionDiffCard";
import { Section } from "@/components/ui/card";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CompareWorkspaceProps {
  baseResume: BaseResumeDetail | null;
  draft: ResumeDraft | null;
  editMode: boolean;
  editContent: string;
  isSavingDraft: boolean;
  onCancelEdit: () => void;
  onContentChange: (val: string) => void;
  onSaveDraft: () => void;
  pageLength?: string | null;
  aggressiveness?: string | null;
  className?: string;
}

export function CompareWorkspace({
  baseResume,
  draft,
  editMode,
  editContent,
  isSavingDraft,
  onCancelEdit,
  onContentChange,
  onSaveDraft,
  pageLength,
  aggressiveness,
  className = "",
}: CompareWorkspaceProps) {
  const [viewLayout, setViewLayout] = useState<"unified" | "split" | "clean">(
    "unified",
  );
  const [highlightMode, setHighlightMode] =
    useState<DiffHighlightMode>("smart");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const sectionsContainerRef = useRef<HTMLDivElement>(null);

  // Compute structured diff
  const summary = useMemo(() => {
    const source = draft?.source_snapshot;
    const includedDraftIds = new Set(
      draft?.document?.sections
        .filter((section) => section.enabled)
        .map((section) => section.id),
    );
    // Re-included sections still compare with their frozen source content.
    const comparisonSource = source?.document
      ? {
          ...source.document,
          sections: source.document.sections.map((section) => ({
            ...section,
            enabled: section.enabled || includedDraftIds.has(section.id),
          })),
        }
      : null;
    const baseDoc = comparisonSource
      ? parseResumeDocument(comparisonSource, source?.content_md)
      : parseResume(baseResume?.content_md ?? "");
    const tailoredDoc = draft?.document
      ? parseResumeDocument(draft.document, draft.content_md)
      : parseResume(draft?.content_md ?? "", draft?.render_model);
    return compareResumeDocs(baseDoc, tailoredDoc);
  }, [
    baseResume?.content_md,
    draft?.content_md,
    draft?.render_model,
    draft?.document,
    draft?.source_snapshot,
  ]);

  // Filter sections if one is selected
  const displayedSections = useMemo(() => {
    if (!activeSectionId) return summary.sections;
    return summary.sections.filter((s) => s.id === activeSectionId);
  }, [summary.sections, activeSectionId]);

  // GSAP animation when sections change or view updates
  useEffect(() => {
    if (!sectionsContainerRef.current) return;
    const cards =
      sectionsContainerRef.current.querySelectorAll(".diff-section-card");
    if (cards.length > 0) {
      const animation = gsap.fromTo(
        cards,
        { opacity: 0, y: 14 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.05,
          ease: "power2.out",
          clearProps: "transform,opacity",
        },
      );
      return () => {
        animation.kill();
      };
    }
  }, [displayedSections, viewLayout]);

  const baseResumeName = draft?.source_snapshot
    ? `Source revision ${draft.source_snapshot.revision}`
    : (baseResume?.name ?? "Baseline Resume");

  return (
    <div
      className={cn("compare-workspace compare-pane-card space-y-4", className)}
      data-testid="compare-workspace"
    >
      {/* Hidden baseline semantic anchors for screen readers & test assertions */}
      <Heading level={2} className="sr-only">
        Base Resume
      </Heading>

      {!draft?.source_snapshot && (
        <Text
          as="p"
          display="block"
          type="supporting"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Legacy comparison uses the available base resume. Its text may have
          changed since generation, and matches use headings and text.
        </Text>
      )}
      {/* Hero Control Bar */}
      <CompareHeroBar
        summary={summary}
        baseResumeName={baseResumeName}
        pageLength={pageLength}
        aggressiveness={aggressiveness}
        viewLayout={viewLayout}
        highlightMode={highlightMode}
        onViewLayoutChange={setViewLayout}
        onHighlightModeChange={setHighlightMode}
        sectionNavigation={!editMode && summary.sections.length > 1 ? (
          <CompareSectionNav sections={summary.sections} activeSectionId={activeSectionId} onSelectSection={setActiveSectionId} />
        ) : undefined}
      />

      {/* Edit Mode Panel or Comparison Stream */}
      {editMode ? (
        <Section className="p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between border-b pb-2.5">
            <Heading
              level={3}
              style={{ color: "var(--color-accent)" }}
            >
              Edit Tailored Draft
            </Heading>
            <span
              className="text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Changes will immediately update the comparison diff upon saving.
            </span>
          </div>
          <div
            className="mt-0.5 flex min-h-0 flex-1 flex-col overflow-hidden"
            style={{ minHeight: "60vh" }}
          >
            <MarkdownEditor
              className="no-bottom-radius flex-1 min-h-0"
              value={editContent}
              onChange={(event) => onContentChange(event.target.value)}
            />
            <div className="markdown-editor-footer flex-shrink-0">
              <span>
                Markdown · {editContent.length.toLocaleString()} characters
              </span>
              <span>Tab = 2 spaces</span>
            </div>
            <div className="mt-3 flex flex-shrink-0 items-center gap-3">
              <ActionButtons label="Draft editing" size="sm" primaryIndex={0}>
                <Button
                  size="sm"
                  loading={isSavingDraft}
                  disabled={isSavingDraft || !editContent.trim()}
                  onClick={onSaveDraft}
                >
                  {isSavingDraft ? "Saving…" : "Save Draft"}
                </Button>
                <Button size="sm" variant="secondary" onClick={onCancelEdit}>
                  Cancel
                </Button>

              </ActionButtons>
</div>
          </div>
        </Section>
      ) : (
        <div className="space-y-4">
          {/* Section Cards Stream */}
          <div ref={sectionsContainerRef} className="space-y-6">
            {displayedSections.map((sec, idx) => (
              <SectionDiffCard
                key={sec.id}
                sectionDiff={sec}
                viewLayout={viewLayout}
                highlightMode={highlightMode}
                sectionIndex={idx}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
