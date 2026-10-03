import {
  Sparkles,
  Edit3,
  FileDown,
  X,
  Layers,
  CheckCircle2,
  FileText,
  LayoutList,
  Columns2,
} from "lucide-react";
import type { ResumeComparisonSummary, DiffHighlightMode } from "./diff-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CompareHeroBarProps {
  summary: ResumeComparisonSummary;
  baseResumeName: string;
  pageLength?: string | null;
  aggressiveness?: string | null;
  viewLayout: "unified" | "split" | "clean";
  highlightMode: DiffHighlightMode;
  onViewLayoutChange: (layout: "unified" | "split" | "clean") => void;
  onHighlightModeChange: (mode: DiffHighlightMode) => void;
  onEnterEdit: () => void;
  onExportPdf?: () => void;
  onCloseCompare: () => void;
  isExporting?: boolean;
}

export function CompareHeroBar({
  summary,
  baseResumeName,
  pageLength,
  aggressiveness,
  viewLayout,
  highlightMode,
  onViewLayoutChange,
  onHighlightModeChange,
  onEnterEdit,
  onExportPdf,
  onCloseCompare,
  isExporting = false,
}: CompareHeroBarProps) {
  const { stats } = summary;

  return (
    <div
      className="sticky top-[calc(var(--topbar-height)+0.5rem)] z-20 rounded-2xl border p-3.5 sm:p-4 shadow-sm backdrop-blur-md transition-all"
      style={{
        background: "var(--color-background-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Top row: Title, Badges, and Global Action Buttons */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        {/* Left side: Context Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm"
            style={{ color: "var(--color-text-primary)" }}
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{
                background: "var(--color-accent-muted)",
                color: "var(--color-accent)",
              }}
            >
              <Sparkles size={14} />
            </span>
            <span>Tailored Comparison</span>
          </div>

          <span
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-background-muted)",
              color: "var(--color-text-secondary)",
            }}
          >
            <FileText size={12} className="opacity-70" />
            Base:{" "}
            <strong className="text-[var(--color-text-primary)]">
              {baseResumeName}
            </strong>
          </span>

          {aggressiveness && (
            <span
              className="hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase"
              style={{
                borderColor: "var(--color-success-muted)",
                background: "var(--color-accent-muted)",
                color: "var(--color-accent)",
              }}
            >
              {aggressiveness} Tailoring
            </span>
          )}

          {pageLength && (
            <span
              className="hidden md:inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-background-muted)",
                color: "var(--color-text-secondary)",
              }}
            >
              {pageLength.replace("_", " ")}
            </span>
          )}
        </div>

        {/* Right side: Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 text-xs"
            onClick={onEnterEdit}
            title="Edit tailored markdown draft"
          >
            <Edit3 size={13} />
            <span>Edit</span>
          </Button>

          {onExportPdf && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 gap-1.5 text-xs hidden sm:inline-flex"
              disabled={isExporting}
              onClick={onExportPdf}
            >
              <FileDown size={13} />
              <span>{isExporting ? "Exporting…" : "Export PDF"}</span>
            </Button>
          )}

          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onCloseCompare}
          >
            <X size={13} />
            <span>Close Comparison</span>
          </Button>
        </div>
      </div>

      {/* Bottom row: Diff Stats & Layout Controls */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Key Metrics */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <div className="flex items-center gap-1.5">
            <Layers
              size={13}
              className="opacity-70 text-[var(--color-success)]"
            />
            <span>
              <strong>{stats.totalRoles}</strong> Roles (
              {stats.retitledRoles > 0
                ? `${stats.retitledRoles} retitled`
                : "aligned"}
              )
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <CheckCircle2
              size={13}
              className="opacity-70 text-[var(--color-success)]"
            />
            <span>
              <strong>{stats.modifiedBullets + stats.addedBullets}</strong>{" "}
              Bullets Refined
            </span>
          </div>

          {stats.addedSkillsCount > 0 && (
            <div
              className="flex items-center gap-1.5 font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              <Sparkles size={13} />
              <span>+{stats.addedSkillsCount} Keywords Aligned</span>
            </div>
          )}
        </div>

        {/* View Controls & Highlighting Switch */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Highlighting Mode Selector */}
          <div
            className="inline-flex items-center rounded-lg border p-0.5 shadow-2xs"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-background-muted)",
            }}
          >
            <Button
              variant="ghost"
              type="button"
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold transition-all",
                highlightMode === "smart"
                  ? "bg-[var(--color-background-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-low)] font-bold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              )}
              onClick={() => onHighlightModeChange("smart")}
              title="Show all word-level additions and deletions"
            >
              Smart Diff
            </Button>
            <Button
              variant="ghost"
              type="button"
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold transition-all",
                highlightMode === "additions-only"
                  ? "bg-[var(--color-background-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-low)] font-bold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              )}
              onClick={() => onHighlightModeChange("additions-only")}
              title="Highlight only tailored additions"
            >
              Additions
            </Button>
            <Button
              variant="ghost"
              type="button"
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold transition-all",
                highlightMode === "clean"
                  ? "bg-[var(--color-background-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-low)] font-bold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              )}
              onClick={() => onHighlightModeChange("clean")}
              title="Clean tailored view without annotations"
            >
              Clean
            </Button>
          </div>

          {/* Layout Mode Selector */}
          <div
            className="inline-flex items-center rounded-lg border p-0.5 shadow-2xs"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-background-muted)",
            }}
          >
            <Button
              variant="ghost"
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all",
                viewLayout === "unified"
                  ? "bg-[var(--color-background-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-low)] font-bold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              )}
              onClick={() => onViewLayoutChange("unified")}
              title="Unified vertical stream with in-line diffs"
            >
              <LayoutList size={12} />
              <span>Unified</span>
            </Button>
            <Button
              variant="ghost"
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all",
                viewLayout === "split"
                  ? "bg-[var(--color-background-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-low)] font-bold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              )}
              onClick={() => onViewLayoutChange("split")}
              title="Side-by-side cards comparing base and tailored"
            >
              <Columns2 size={12} />
              <span>Side by Side</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
