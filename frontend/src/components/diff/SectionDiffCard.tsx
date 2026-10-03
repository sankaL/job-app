import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
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
import { Section } from "@/components/ui/card";

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
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopySection = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyError(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
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
      <div
        className="flex items-center justify-between border-b pb-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{
              background: "var(--color-accent-muted)",
              color: "var(--color-accent)",
              border: "1px solid var(--color-success-muted)",
            }}
          >
            {getSectionIcon()}
          </span>
          <h3
            className="text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--color-text-primary)" }}
          >
            {sectionDiff.heading}
          </h3>
          {sectionDiff.status !== "unchanged" && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: "var(--color-accent-muted)",
                color: "var(--color-accent)",
                border: "1px solid var(--color-success-muted)",
              }}
            >
              <Sparkles size={10} />{" "}
              {sectionDiff.status === "added"
                ? "Added"
                : sectionDiff.status === "removed"
                  ? "Omitted"
                  : "Tailored"}
            </span>
          )}
        </div>

        {/* Copy Section Markdown Utility */}
        {sectionDiff.tailoredSection?.rawMarkdown && (
          <Button
            variant="ghost"
            type="button"
            className="inline-flex items-center gap-1 text-[11px] transition-colors hover:text-[var(--color-text-primary)]"
            onClick={() =>
              handleCopySection(sectionDiff.tailoredSection!.rawMarkdown)
            }
            title="Copy section markdown"
          >
            {copied ? (
              <>
                <Check size={12} style={{ color: "var(--color-accent)" }} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>Copy Section</span>
              </>
            )}
          </Button>
        )}
      </div>

      {copyError && (
        <p
          role="alert"
          className="text-xs"
          style={{ color: "var(--color-error)" }}
        >
          Unable to copy. Try selecting the section text instead.
        </p>
      )}
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
        <Section className="p-4 sm:p-5">
          {viewLayout === "split" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div
                className="border-l p-3.5"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-background-muted)",
                }}
              >
                <span
                  className="mb-2 block text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Base Summary
                </span>
                <p
                  className="text-xs sm:text-sm leading-relaxed"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {sectionDiff.summaryDiff.baseText}
                </p>
              </div>
              <div
                className="border-l p-3.5"
                style={{
                  borderColor: "var(--color-success-muted)",
                  background: "var(--color-success-muted)",
                }}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles
                    size={13}
                    style={{ color: "var(--color-accent)" }}
                  />
                  <span
                    className="text-xs font-bold uppercase tracking-wider"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Tailored Summary
                  </span>
                </div>
                <p
                  className="text-xs sm:text-sm leading-relaxed"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  <InlineDiffText
                    chunks={sectionDiff.summaryDiff.chunks}
                    mode={highlightMode}
                    showRemoved={false}
                  />
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="text-xs sm:text-sm leading-relaxed"
                style={{ color: "var(--color-text-primary)" }}
              >
                <InlineDiffText
                  chunks={sectionDiff.summaryDiff.chunks}
                  mode={highlightMode}
                />
              </div>
              {sectionDiff.summaryDiff.baseText &&
                sectionDiff.status === "modified" && (
                  <div
                    className="border-l p-3 text-xs leading-relaxed"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-background-muted)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <span
                      className="mb-1 block text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      Base Summary
                    </span>
                    <p>{sectionDiff.summaryDiff.baseText}</p>
                  </div>
                )}
            </div>
          )}
        </Section>
      )}

      {/* Skills Section */}
      {sectionDiff.kind === "skills" && sectionDiff.skillsDiff && (
        <Section className="p-4 sm:p-5">
          <div className="space-y-3">
            {/* Added / Targeted Skills */}
            {sectionDiff.skillsDiff.addedSkills.length > 0 && (
              <div>
                <span
                  className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-accent)" }}
                >
                  <Sparkles size={12} /> Target ATS Keywords Added (
                  {sectionDiff.skillsDiff.addedSkills.length})
                </span>
                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                  {sectionDiff.skillsDiff.addedSkills.map((skill, idx) => (
                    <li
                      key={`added-skill-${idx}`}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold"
                      style={{
                        background: "var(--color-success-muted)",
                        color: "var(--color-accent)",
                        border: "1px solid var(--color-success-muted)",
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
                <span
                  className="mb-2 block text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Retained Core Skills (
                  {sectionDiff.skillsDiff.retainedSkills.length})
                </span>
                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                  {sectionDiff.skillsDiff.retainedSkills.map((skill, idx) => (
                    <li
                      key={`retained-skill-${idx}`}
                      className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-background-muted)",
                        color: "var(--color-text-secondary)",
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
                <span
                  className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-error)" }}
                >
                  <Minus size={12} /> Omitted Skills (
                  {sectionDiff.skillsDiff.removedSkills.length})
                </span>
                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                  {sectionDiff.skillsDiff.removedSkills.map((skill, idx) => (
                    <li
                      key={`removed-skill-${idx}`}
                      className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium line-through"
                      style={{
                        borderColor: "var(--color-error-muted)",
                        background: "var(--color-error-muted)",
                        color: "var(--color-error)",
                      }}
                    >
                      {skill}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Education Section */}
      {sectionDiff.kind === "education" && sectionDiff.educationDiffs && (
        <div className="space-y-3">
          {sectionDiff.educationDiffs.map((edu) => (
            <Section key={edu.id} className="p-4">
              <div
                className="flex flex-wrap items-start justify-between gap-2 border-b pb-2.5"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div>
                  <h4
                    className="text-sm font-bold"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {edu.institutionChunks ? (
                      <InlineDiffText
                        chunks={edu.institutionChunks}
                        mode={highlightMode}
                      />
                    ) : (
                      edu.institution
                    )}
                  </h4>
                  <p
                    className="text-xs font-medium mt-0.5"
                    style={{ color: "var(--color-accent)" }}
                  >
                    <InlineDiffText
                      chunks={edu.degree.chunks}
                      mode={highlightMode}
                    />
                  </p>
                </div>
                <div
                  className="text-right text-xs"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {edu.dateRangeChunks ? (
                    <div>
                      <InlineDiffText
                        chunks={edu.dateRangeChunks}
                        mode={highlightMode}
                      />
                    </div>
                  ) : edu.dateRange ? (
                    <div>{edu.dateRange}</div>
                  ) : null}
                  {edu.locationChunks ? (
                    <div>
                      <InlineDiffText
                        chunks={edu.locationChunks}
                        mode={highlightMode}
                      />
                    </div>
                  ) : edu.location ? (
                    <div>{edu.location}</div>
                  ) : null}
                </div>
              </div>
              {edu.bullets.length > 0 && (
                <ul
                  className="mt-3 list-disc space-y-1.5 pl-5 text-xs leading-relaxed"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {edu.bullets.map((b) => (
                    <li key={b.id}>
                      <InlineDiffText chunks={b.chunks} mode={highlightMode} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ))}
        </div>
      )}

      {sectionDiff.entryDiffs && (
        <div className="space-y-3">
          {sectionDiff.entryDiffs.map((entry) => (
            <Section key={entry.id} className="p-4">
              <div className="space-y-2">
                {entry.fields.map((field) => (
                  <div key={field.name} className="text-xs">
                    <span
                      className="mr-2 font-semibold"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {field.name.replaceAll("_", " ")}
                    </span>
                    <InlineDiffText
                      chunks={field.chunks}
                      mode={highlightMode}
                    />
                  </div>
                ))}
              </div>
              {entry.bullets.length > 0 && (
                <ul className="mt-3 list-disc space-y-2 pl-4 text-sm">
                  {entry.bullets.map((bullet) => (
                    <li key={bullet.id}>
                      <InlineDiffText
                        chunks={bullet.chunks}
                        mode={highlightMode}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ))}
        </div>
      )}
      {/* Generic / Custom Section */}
      {!["professional_experience", "summary", "skills", "education"].includes(
        sectionDiff.kind,
      ) &&
        !sectionDiff.entryDiffs &&
        sectionDiff.genericDiff && (
          <Section className="p-4 sm:p-5">
            <div
              className="text-xs sm:text-sm leading-relaxed"
              style={{ color: "var(--color-text-primary)" }}
            >
              <InlineDiffText
                chunks={sectionDiff.genericDiff.chunks}
                mode={highlightMode}
              />
            </div>
          </Section>
        )}
    </section>
  );
}
