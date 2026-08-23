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
                "bg-[rgba(24,74,69,0.14)] text-[#133c38]",
                "dark:bg-[rgba(40,167,69,0.2)] dark:text-[#56d364]",
                "border-b border-[rgba(24,74,69,0.3)]",
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
                "bg-[rgba(159,58,22,0.12)] text-[#822f12]",
                "dark:bg-[rgba(248,81,73,0.15)] dark:text-[#f85149]",
              )}
              title="Base resume text omitted/replaced"
            >
              {chunk.value}
            </del>
          );
        }

        return <React.Fragment key={`chunk-${index}`}>{chunk.value}</React.Fragment>;
      })}
    </span>
  );
}
