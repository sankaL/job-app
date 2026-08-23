import React, { useMemo, useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { BaseResumeDetail, ResumeDraft } from "@/lib/api";
import { parseResume } from "./resume-parser";
import { compareResumeDocs, type DiffHighlightMode } from "./diff-engine";
import { CompareHeroBar } from "./CompareHeroBar";
import { CompareSectionNav } from "./CompareSectionNav";
import { SectionDiffCard } from "./SectionDiffCard";
import { Card } from "@/components/ui/card";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CompareWorkspaceProps {
  baseResume: BaseResumeDetail | null;
  draft: ResumeDraft | null;
  editMode: boolean;
  editContent: string;
  isSavingDraft: boolean;
  onEnterEdit: () => void;
  onCancelEdit: () => void;
  onContentChange: (val: string) => void;
  onSaveDraft: () => void;
  onCloseCompare: () => void;
  onExportPdf?: () => void;
  isExporting?: boolean;
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
  onEnterEdit,
  onCancelEdit,
  onContentChange,
  onSaveDraft,
  onCloseCompare,
  onExportPdf,
  isExporting = false,
  pageLength,
  aggressiveness,
  className = "",
}: CompareWorkspaceProps) {
  const [viewLayout, setViewLayout] = useState<"unified" | "split" | "clean">("unified");
  const [highlightMode, setHighlightMode] = useState<DiffHighlightMode>("smart");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const sectionsContainerRef = useRef<HTMLDivElement>(null);

  // Compute structured diff
  const summary = useMemo(() => {
    const baseDoc = parseResume(baseResume?.content_md ?? "");
    const tailoredDoc = parseResume(draft?.content_md ?? "", draft?.render_model);
    return compareResumeDocs(baseDoc, tailoredDoc);
  }, [baseResume?.content_md, draft?.content_md, draft?.render_model]);

  // Filter sections if one is selected
  const displayedSections = useMemo(() => {
    if (!activeSectionId) return summary.sections;
    return summary.sections.filter((s) => s.id === activeSectionId);
  }, [summary.sections, activeSectionId]);

  // GSAP animation when sections change or view updates
  useEffect(() => {
    if (!sectionsContainerRef.current) return;
    const cards = sectionsContainerRef.current.querySelectorAll(".diff-section-card");
    if (cards.length > 0) {
      gsap.fromTo(
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
    }
  }, [displayedSections, viewLayout]);

  const baseResumeName = baseResume?.name ?? "Baseline Resume";

  return (
    <div
      className={cn("compare-workspace compare-pane-card space-y-4", className)}
      data-testid="compare-workspace"
    >
      {/* Hidden baseline semantic anchors for screen readers & test assertions */}
      <h2 className="sr-only">Base Resume</h2>

      {/* Hero Control Bar */}
      <CompareHeroBar
        summary={summary}
        baseResumeName={baseResumeName}
        generatedTimestamp={draft?.last_generated_at ?? null}
        pageLength={pageLength}
        aggressiveness={aggressiveness}
        viewLayout={viewLayout}
        highlightMode={highlightMode}
        onViewLayoutChange={setViewLayout}
        onHighlightModeChange={setHighlightMode}
        onEnterEdit={onEnterEdit}
        onExportPdf={onExportPdf}
        onCloseCompare={onCloseCompare}
        isExporting={isExporting}
      />

      {/* Edit Mode Panel or Comparison Stream */}
      {editMode ? (
        <Card
          className="rounded-2xl border p-4 sm:p-6 shadow-sm"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-white)",
          }}
        >
          <div className="mb-3 flex items-center justify-between border-b pb-2.5">
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>
              Edit Tailored Draft
            </h3>
            <span className="text-xs" style={{ color: "var(--color-ink-40)" }}>
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
              <span>Markdown · {editContent.length.toLocaleString()} characters</span>
              <span>Tab = 2 spaces</span>
            </div>
            <div className="mt-3 flex flex-shrink-0 items-center gap-3">
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
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Section Navigation Tabs */}
          {summary.sections.length > 1 && (
            <CompareSectionNav
              sections={summary.sections}
              activeSectionId={activeSectionId}
              onSelectSection={setActiveSectionId}
            />
          )}

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
