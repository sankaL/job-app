import React, { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { SectionDiff } from "./diff-engine";
import { cn } from "@/lib/utils";

interface CompareSectionNavProps {
  sections: SectionDiff[];
  activeSectionId: string | null;
  onSelectSection: (sectionId: string | null) => void;
}

export function CompareSectionNav({
  sections,
  activeSectionId,
  onSelectSection,
}: CompareSectionNavProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !pillRef.current) return;

    const activeBtn = containerRef.current.querySelector(
      `button[data-section-id="${activeSectionId ?? "all"}"]`,
    ) as HTMLElement | null;

    if (activeBtn) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      const left = btnRect.left - containerRect.left;
      const width = btnRect.width;

      gsap.to(pillRef.current, {
        x: left,
        width: width,
        opacity: 1,
        duration: 0.28,
        ease: "power2.out",
      });
    }
  }, [activeSectionId, sections]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 overflow-x-auto rounded-xl border p-1 no-scrollbar"
      style={{
        background: "var(--color-white)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Sliding GSAP Indicator Pill */}
      <div
        ref={pillRef}
        className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-lg shadow-2xs opacity-0"
        style={{
          background: "var(--color-spruce-10)",
          border: "1px solid rgba(24, 74, 69, 0.2)",
        }}
      />

      {/* "All" Tab */}
      <button
        type="button"
        data-section-id="all"
        className={cn(
          "relative z-10 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
          activeSectionId === null
            ? "text-[#184a45] font-bold"
            : "text-[var(--color-ink-65)] hover:text-black",
        )}
        onClick={() => onSelectSection(null)}
      >
        All Sections
      </button>

      {/* Individual Section Tabs */}
      {sections.map((sec, idx) => {
        const isActive = activeSectionId === sec.id;
        const itemCount =
          sec.kind === "professional_experience"
            ? sec.experienceDiffs?.length ?? 0
            : sec.kind === "skills"
              ? (sec.skillsDiff?.addedSkills.length ?? 0) + (sec.skillsDiff?.removedSkills.length ?? 0)
              : null;

        return (
          <button
            key={sec.id}
            type="button"
            data-section-id={sec.id}
            className={cn(
              "relative z-10 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              isActive
                ? "text-[#184a45] font-bold"
                : "text-[var(--color-ink-65)] hover:text-black",
            )}
            onClick={() => onSelectSection(sec.id)}
          >
            <span>{sec.heading}</span>
            {itemCount !== null && itemCount > 0 && (
              <span
                className="rounded-full px-1.5 py-0.2 text-[10px] font-bold"
                style={{
                  background: isActive ? "rgba(24, 74, 69, 0.2)" : "var(--color-ink-05)",
                  color: isActive ? "var(--color-spruce)" : "var(--color-ink-50)",
                }}
              >
                {sec.kind === "skills" ? itemCount : itemCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
