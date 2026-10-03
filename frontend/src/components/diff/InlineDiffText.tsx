import React from "react";
import type { WordDiffChunk } from "./diff-engine";
import { cn } from "@/lib/utils";

export type DiffHighlightMode = "smart" | "additions-only" | "clean";

interface InlineDiffTextProps {
  chunks: WordDiffChunk[];
  mode?: DiffHighlightMode;
  className?: string;
  showRemoved?: boolean;
}

export function InlineDiffText({
  chunks,
  mode = "smart",
  className = "",
  showRemoved = true,
}: InlineDiffTextProps) {
  if (!chunks || chunks.length === 0) return null;

  if (mode === "clean") {
    // Only render non-removed chunks
    const cleanText = chunks
      .filter((c) => !c.removed)
      .map((c) => c.value)
      .join("");
    return <span className={className}>{cleanText}</span>;
  }

  return (
    <span className={cn("inline leading-relaxed", className)}>
      {chunks.map((chunk, index) => {
        if (chunk.added) {
          return (
            <mark
              key={`chunk-${index}`}
              className={cn(
                "rounded px-1 py-0.5 font-medium transition-colors",
                "bg-[var(--color-success-muted)] text-[var(--color-success)]",
                "dark:bg-[var(--color-success-muted)] dark:text-[var(--color-success)]",
                "border-b border-[var(--color-success-muted)]",
              )}
              title="Tailored addition"
            >
              {chunk.value}
            </mark>
          );
        }

        if (chunk.removed) {
          if (!showRemoved || mode === "additions-only") return null;
          return (
            <del
              key={`chunk-${index}`}
              className={cn(
                "rounded px-1 py-0.5 line-through opacity-70 transition-colors",
                "bg-[var(--color-error-muted)] text-[var(--color-error)]",
                "dark:bg-[var(--color-error-muted)] dark:text-[var(--color-error)]",
              )}
              title="Base resume text omitted/replaced"
            >
              {chunk.value}
            </del>
          );
        }

        return (
          <React.Fragment key={`chunk-${index}`}>{chunk.value}</React.Fragment>
        );
      })}
    </span>
  );
}
