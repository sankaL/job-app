import React, { useState } from "react";
import {
  Building2,
  Calendar,
  MapPin,
  Sparkles,
  ArrowRight,
  Check,
  Copy,
  Plus,
  Minus,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { ExperienceEntryDiff, DiffHighlightMode } from "./diff-engine";
import { InlineDiffText } from "./InlineDiffText";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ExperienceDiffCardProps {
  entryDiff: ExperienceEntryDiff;
  viewLayout: "unified" | "split" | "clean";
  highlightMode: DiffHighlightMode;
  index: number;
}

export function ExperienceDiffCard({
  entryDiff,
  viewLayout,
  highlightMode,
  index: _index,
}: ExperienceDiffCardProps) {
  const [copiedBulletId, setCopiedBulletId] = useState<string | null>(null);
  const [expandedSideBySide, setExpandedSideBySide] = useState(false);

  const isSplit = viewLayout === "split" || expandedSideBySide;

  const handleCopyBullet = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedBulletId(id);
    setTimeout(() => setCopiedBulletId(null), 2000);
  };

  const getStatusBadge = () => {
    if (entryDiff.status === "added") {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{
            background: "var(--color-spruce-10)",
            color: "var(--color-spruce)",
            border: "1px solid rgba(24, 74, 69, 0.2)",
          }}
        >
          <Plus size={11} /> New Experience
        </span>
      );
    }
    if (entryDiff.status === "removed") {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{
            background: "var(--color-ember-10)",
            color: "var(--color-ember)",
            border: "1px solid rgba(159, 58, 22, 0.2)",
          }}
        >
          <Minus size={11} /> Omitted for Space
        </span>
      );
    }
    if (entryDiff.title.isRetitled) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{
            background: "rgba(24, 74, 69, 0.12)",
            color: "var(--color-spruce)",
            border: "1px solid rgba(24, 74, 69, 0.25)",
          }}
        >
          <Sparkles size={11} /> Retitled & Tailored
        </span>
      );
    }
    if (entryDiff.stats.modifiedBullets > 0 || entryDiff.stats.addedBullets > 0) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{
            background: "var(--color-ink-05)",
            color: "var(--color-ink-65)",
            border: "1px solid var(--color-border)",
          }}
        >
          {entryDiff.stats.modifiedBullets + entryDiff.stats.addedBullets} Changes
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{
          background: "var(--color-ink-05)",
          color: "var(--color-ink-40)",
        }}
      >
        Unchanged
      </span>
    );
  };

  return (
    <Card
      className={cn(
        "group relative overflow-hidden rounded-xl border p-4 sm:p-5 transition-all duration-200",
        "hover:shadow-md",
      )}
      style={{
        borderColor: entryDiff.title.isRetitled ? "rgba(24, 74, 69, 0.22)" : "var(--color-border)",
        background: "var(--color-white)",
      }}
    >
      {/* Top Header: Company + Metadata + Status */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3.5" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-xs"
            style={{
              background: "var(--color-spruce-05)",
              color: "var(--color-spruce)",
              border: "1px solid rgba(24, 74, 69, 0.15)",
            }}
            aria-hidden="true"
          >
            <Building2 size={20} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-bold tracking-tight" style={{ color: "var(--color-ink)" }}>
                {entryDiff.company}
              </h4>
              {getStatusBadge()}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--color-ink-50)" }}>
              {entryDiff.dateRange.tailored || entryDiff.dateRange.base ? (
                <span className="inline-flex items-center gap-1 font-medium">
                  <Calendar size={13} className="opacity-70" />
                  {entryDiff.dateRange.tailored || entryDiff.dateRange.base}
                </span>
              ) : null}
              {entryDiff.location.tailored || entryDiff.location.base ? (
                <span className="inline-flex items-center gap-1 font-medium">
                  <MapPin size={13} className="opacity-70" />
                  {entryDiff.location.tailored || entryDiff.location.base}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* View Toggle within card */}
        {viewLayout !== "split" && (
          <button
            type="button"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--color-ink-50)" }}
            onClick={() => setExpandedSideBySide((prev) => !prev)}
            title={expandedSideBySide ? "Switch to unified diff" : "Show side-by-side card comparison"}
          >
            {expandedSideBySide ? (
              <>
                <Minimize2 size={13} />
                <span>Unified Diff</span>
              </>
            ) : (
              <>
                <Maximize2 size={13} />
                <span>Side by Side</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Role Title Section */}
      <div className="my-3.5">
        {entryDiff.title.isRetitled ? (
          <div
            className="rounded-lg border p-3"
            style={{
              background: "linear-gradient(135deg, rgba(24, 74, 69, 0.04) 0%, rgba(24, 74, 69, 0.08) 100%)",
              borderColor: "rgba(24, 74, 69, 0.2)",
            }}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>
              <Sparkles size={13} /> Role Title Targeted
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="line-through opacity-70" style={{ color: "var(--color-ember)" }}>
                {entryDiff.title.base}
              </span>
              <ArrowRight size={14} className="shrink-0" style={{ color: "var(--color-spruce)" }} />
              <span className="font-bold" style={{ color: "var(--color-spruce)" }}>
                {entryDiff.title.tailored}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
              Role:
            </span>
            <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              <InlineDiffText chunks={entryDiff.title.chunks} mode={highlightMode} />
            </span>
          </div>
        )}
      </div>

      {/* Bullets Comparison Section */}
      <div className="mt-4">
        {isSplit ? (
          /* Split Side-by-Side View inside card */
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Base Bullets Column */}
            <div
              className="rounded-lg border p-3"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-ink-05)",
              }}
            >
              <div className="mb-2 flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--color-border)" }}>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
                  Base Resume
                </span>
                <span className="text-[11px]" style={{ color: "var(--color-ink-40)" }}>
                  {entryDiff.bullets.filter((b) => b.baseText).length} bullets
                </span>
              </div>
              <ul className="space-y-2.5 text-xs leading-relaxed" style={{ color: "var(--color-ink-65)" }}>
                {entryDiff.bullets
                  .filter((b) => b.baseText)
                  .map((bullet) => (
                    <li key={`base-${bullet.id}`} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-ink-30)" }} />
                      <div className="flex-1">
                        {bullet.status === "removed" ? (
                          <del className="opacity-70" style={{ color: "var(--color-ember)" }}>
                            {bullet.baseText}
                          </del>
                        ) : (
                          <span>{bullet.baseText}</span>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>

            {/* Tailored Bullets Column */}
            <div
              className="rounded-lg border p-3"
              style={{
                borderColor: "rgba(24, 74, 69, 0.2)",
                background: "rgba(24, 74, 69, 0.02)",
              }}
            >
              <div className="mb-2 flex items-center justify-between border-b pb-1.5" style={{ borderColor: "rgba(24, 74, 69, 0.15)" }}>
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} style={{ color: "var(--color-spruce)" }} />
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>
                    Tailored Draft
                  </span>
                </div>
                <span className="text-[11px]" style={{ color: "var(--color-spruce)" }}>
                  {entryDiff.bullets.filter((b) => b.tailoredText).length} bullets
                </span>
              </div>
              <ul className="space-y-2.5 text-xs leading-relaxed" style={{ color: "var(--color-ink)" }}>
                {entryDiff.bullets
                  .filter((b) => b.tailoredText)
                  .map((bullet) => (
                    <li key={`tailored-${bullet.id}`} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-spruce)" }} />
                      <div className="flex-1">
                        <InlineDiffText chunks={bullet.chunks} mode={highlightMode} showRemoved={false} />
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        ) : (
          /* Unified Stream View with in-line smart diff */
          <div className="space-y-3">
            {entryDiff.bullets.map((bullet) => {
              const isAdded = bullet.status === "added";
              const isModified = bullet.status === "modified";
              const isRemoved = bullet.status === "removed";

              return (
                <div
                  key={bullet.id}
                  className={cn(
                    "group/bullet relative rounded-lg border p-3 text-xs leading-relaxed transition-all",
                    isAdded && "border-[rgba(24,74,69,0.2)] bg-[rgba(24,74,69,0.03)]",
                    isRemoved && "border-[rgba(159,58,22,0.15)] bg-[rgba(159,58,22,0.03)] opacity-75",
                    !isAdded && !isRemoved && "border-[var(--color-border)] bg-[var(--color-white)] hover:border-black/15",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-1 items-start gap-2.5">
                      {/* Status Icon */}
                      <span className="mt-0.5 shrink-0">
                        {isAdded ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[rgba(24,74,69,0.15)] text-[10px] font-bold text-[#184a45]">
                            +
                          </span>
                        ) : isRemoved ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[rgba(159,58,22,0.15)] text-[10px] font-bold text-[#9f3a16]">
                            -
                          </span>
                        ) : isModified ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-700">
                            ~
                          </span>
                        ) : (
                          <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-[var(--color-ink-30)]" />
                        )}
                      </span>

                      {/* Content */}
                      <div className="flex-1">
                        {isRemoved ? (
                          <div>
                            <span className="text-[11px] font-semibold text-[#9f3a16]">Omitted Base Bullet:</span>
                            <p className="mt-0.5 line-through opacity-80" style={{ color: "var(--color-ink-50)" }}>
                              {bullet.baseText}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <InlineDiffText chunks={bullet.chunks} mode={highlightMode} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Copy Button */}
                    {bullet.tailoredText && (
                      <button
                        type="button"
                        className="opacity-0 group-hover/bullet:opacity-100 transition-opacity p-1 rounded hover:bg-black/5 shrink-0"
                        style={{ color: "var(--color-ink-40)" }}
                        onClick={() => handleCopyBullet(bullet.tailoredText!, bullet.id)}
                        title="Copy tailored bullet text"
                      >
                        {copiedBulletId === bullet.id ? (
                          <Check size={12} style={{ color: "var(--color-spruce)" }} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
