import React, { useState } from "react";
import {
  FileText,
  GraduationCap,
  Wrench,
  Award,
  Layers,
  Sparkles,
  Check,
  Copy,
  Plus,
  Minus,
} from "lucide-react";
import type { SectionDiff, DiffHighlightMode } from "./diff-engine";
import { InlineDiffText } from "./InlineDiffText";
import { ExperienceDiffCard } from "./ExperienceDiffCard";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SectionDiffCardProps {
  sectionDiff: SectionDiff;
  viewLayout: "unified" | "split" | "clean";
  highlightMode: DiffHighlightMode;
  sectionIndex: number;
}

export function SectionDiffCard({
  sectionDiff,
  viewLayout,
  highlightMode,
  sectionIndex,
}: SectionDiffCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopySection = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getSectionIcon = () => {
    switch (sectionDiff.kind) {
      case "summary":
        return <FileText size={18} />;
      case "professional_experience":
        return <Layers size={18} />;
      case "education":
        return <GraduationCap size={18} />;
      case "skills":
        return <Wrench size={18} />;
      case "certifications":
        return <Award size={18} />;
      default:
        return <Layers size={18} />;
    }
  };

  const isExperience = sectionDiff.kind === "professional_experience";

  return (
    <section
      id={`diff-section-${sectionDiff.kind}-${sectionIndex}`}
      className="diff-section-card space-y-3"
      data-testid={`diff-section-${sectionDiff.kind}`}
    >
      {/* Section Header */}
      <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{
              background: "var(--color-spruce-05)",
              color: "var(--color-spruce)",
              border: "1px solid rgba(24, 74, 69, 0.12)",
            }}
          >
            {getSectionIcon()}
          </span>
          <h3
            className="text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--color-ink)" }}
          >
            {sectionDiff.heading}
          </h3>
          {sectionDiff.status === "modified" && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: "var(--color-spruce-05)",
                color: "var(--color-spruce)",
                border: "1px solid rgba(24, 74, 69, 0.15)",
              }}
            >
              <Sparkles size={10} /> Tailored
            </span>
          )}
        </div>

        {/* Copy Section Markdown Utility */}
        {sectionDiff.tailoredSection?.rawMarkdown && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-medium transition-colors hover:text-black"
            style={{ color: "var(--color-ink-40)" }}
            onClick={() => handleCopySection(sectionDiff.tailoredSection!.rawMarkdown)}
            title="Copy section markdown"
          >
            {copied ? (
              <>
                <Check size={12} style={{ color: "var(--color-spruce)" }} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>Copy Section</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Experience Entries */}
      {isExperience && sectionDiff.experienceDiffs && (
        <div className="space-y-4">
          {sectionDiff.experienceDiffs.map((entry, eIdx) => (
            <ExperienceDiffCard
              key={entry.id}
              entryDiff={entry}
              viewLayout={viewLayout}
              highlightMode={highlightMode}
              index={eIdx}
            />
          ))}
        </div>
      )}

      {/* Summary Section */}
      {sectionDiff.kind === "summary" && sectionDiff.summaryDiff && (
        <Card
          className="rounded-xl border p-4 sm:p-5 shadow-xs"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-white)",
          }}
        >
          {viewLayout === "split" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--color-border)", background: "var(--color-ink-05)" }}>
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
                  Base Summary
                </span>
                <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--color-ink-65)" }}>
                  {sectionDiff.summaryDiff.baseText}
                </p>
              </div>
              <div
                className="rounded-lg border p-3.5"
                style={{
                  borderColor: "rgba(24, 74, 69, 0.2)",
                  background: "rgba(24, 74, 69, 0.02)",
                }}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles size={13} style={{ color: "var(--color-spruce)" }} />
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>
                    Tailored Summary
                  </span>
                </div>
                <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--color-ink)" }}>
                  <InlineDiffText chunks={sectionDiff.summaryDiff.chunks} mode={highlightMode} showRemoved={false} />
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--color-ink)" }}>
                <InlineDiffText chunks={sectionDiff.summaryDiff.chunks} mode={highlightMode} />
              </div>
              {sectionDiff.summaryDiff.baseText && sectionDiff.status === "modified" && (
                <div
                  className="rounded-lg border p-3 text-xs leading-relaxed"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-ink-05)",
                    color: "var(--color-ink-65)",
                  }}
                >
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
                    Base Summary
                  </span>
                  <p>{sectionDiff.summaryDiff.baseText}</p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Skills Section */}
      {sectionDiff.kind === "skills" && sectionDiff.skillsDiff && (
        <Card
          className="rounded-xl border p-4 sm:p-5 shadow-xs"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-white)",
          }}
        >
          <div className="space-y-3">
            {/* Added / Targeted Skills */}
            {sectionDiff.skillsDiff.addedSkills.length > 0 && (
              <div>
                <span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>
                  <Sparkles size={12} /> Target ATS Keywords Added ({sectionDiff.skillsDiff.addedSkills.length})
                </span>
                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                  {sectionDiff.skillsDiff.addedSkills.map((skill, idx) => (
                    <li
                      key={`added-skill-${idx}`}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold"
                      style={{
                        background: "rgba(24, 74, 69, 0.12)",
                        color: "var(--color-spruce)",
                        border: "1px solid rgba(24, 74, 69, 0.25)",
                      }}
                    >
                      <Plus size={11} />
                      {skill}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Core / Retained Skills */}
            {sectionDiff.skillsDiff.retainedSkills.length > 0 && (
              <div>
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
                  Retained Core Skills ({sectionDiff.skillsDiff.retainedSkills.length})
                </span>
                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                  {sectionDiff.skillsDiff.retainedSkills.map((skill, idx) => (
                    <li
                      key={`retained-skill-${idx}`}
                      className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-ink-05)",
                        color: "var(--color-ink-65)",
                      }}
                    >
                      {skill}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sectionDiff.skillsDiff.removedSkills.length > 0 && (
              <div>
                <span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-ember)" }}>
                  <Minus size={12} /> Omitted Skills ({sectionDiff.skillsDiff.removedSkills.length})
                </span>
                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                  {sectionDiff.skillsDiff.removedSkills.map((skill, idx) => (
                    <li
                      key={`removed-skill-${idx}`}
                      className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium line-through"
                      style={{
                        borderColor: "rgba(159, 58, 22, 0.2)",
                        background: "var(--color-ember-10)",
                        color: "var(--color-ember)",
                      }}
                    >
                      {skill}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Education Section */}
      {sectionDiff.kind === "education" && sectionDiff.educationDiffs && (
        <div className="space-y-3">
          {sectionDiff.educationDiffs.map((edu) => (
            <Card
              key={edu.id}
              className="rounded-xl border p-4 shadow-xs"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-white)",
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2.5" style={{ borderColor: "var(--color-border)" }}>
                <div>
                  <h4 className="text-sm font-bold" style={{ color: "var(--color-ink)" }}>
                    {edu.institution}
                  </h4>
                  <p className="text-xs font-medium mt-0.5" style={{ color: "var(--color-spruce)" }}>
                    <InlineDiffText chunks={edu.degree.chunks} mode={highlightMode} />
                  </p>
                </div>
                <div className="text-right text-xs" style={{ color: "var(--color-ink-40)" }}>
                  {edu.dateRange ? <div>{edu.dateRange}</div> : null}
                  {edu.location ? <div>{edu.location}</div> : null}
                </div>
              </div>
              {edu.bullets.length > 0 && (
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs leading-relaxed" style={{ color: "var(--color-ink-65)" }}>
                  {edu.bullets.map((b) => (
                    <li key={b.id}>
                      <InlineDiffText chunks={b.chunks} mode={highlightMode} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Generic / Custom Section */}
      {!["professional_experience", "summary", "skills", "education"].includes(sectionDiff.kind) &&
        sectionDiff.genericDiff && (
          <Card
            className="rounded-xl border p-4 sm:p-5 shadow-xs"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-white)",
            }}
          >
            <div className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--color-ink)" }}>
              <InlineDiffText chunks={sectionDiff.genericDiff.chunks} mode={highlightMode} />
            </div>
          </Card>
        )}
    </section>
  );
}
