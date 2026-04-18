import { useState, useEffect } from "react";
import { Cog, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExtractionProgress } from "@/lib/api";

type GenerationProgressProps = {
  progress: ExtractionProgress | null;
  isOptimistic: boolean;
  isActive: boolean;
  isCancelling: boolean;
  onCancel: () => void;
};

const STAGE_MESSAGES = [
  "Crafting your professional story...",
  "Matching your skills to job requirements...",
  "Polishing bullet points for maximum impact...",
  "Fine-tuning keyword alignment...",
  "Building your best first impression...",
  "Analyzing job requirements...",
  "Optimizing section structure...",
  "Running quality validation...",
];

export function GenerationProgress({
  progress,
  isOptimistic,
  isActive,
  isCancelling,
  onCancel,
}: GenerationProgressProps) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Rotate stage messages every 5 seconds when no real progress message
  useEffect(() => {
    if (!isOptimistic && progress?.message) return;

    const interval = setInterval(() => {
      setStageIndex((i) => (i + 1) % STAGE_MESSAGES.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isOptimistic, progress?.message]);

  // Elapsed time counter
  useEffect(() => {
    if (!isActive) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

  const displayMessage =
    isOptimistic && !progress
      ? STAGE_MESSAGES[stageIndex]
      : progress?.message ?? STAGE_MESSAGES[stageIndex];

  const percentComplete =
    isOptimistic && !progress ? 5 : (progress?.percent_complete ?? 10);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-10 flex flex-col items-center justify-center animate-fadeIn w-80 max-w-sm rounded-xl p-6"
      style={{
        top: "25%",
        background: "rgba(255, 255, 255, 0.97)",
        boxShadow: "0 8px 32px rgba(16, 24, 40, 0.12), 0 2px 8px rgba(16, 24, 40, 0.08)",
      }}
    >
      {/* Animated icons */}
      <div className="relative mb-4 flex items-center justify-center">
        <Cog
          size={40}
          style={{ color: "var(--color-spruce)", animation: "gen-spin 2s linear infinite" }}
        />
        <Sparkles
          size={18}
          className="absolute"
          style={{ color: "var(--color-spruce-light)", animation: "gen-pulse 1.5s ease-in-out infinite" }}
        />
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 w-full max-w-56 overflow-hidden rounded-full"
        style={{ background: "var(--color-ink-10)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${percentComplete}%`,
            background: "var(--color-spruce)",
          }}
        />
      </div>

      {/* Status message */}
      <p
        className="mt-3 text-sm font-medium text-center animate-fadeIn"
        style={{ color: "var(--color-ink)" }}
        key={displayMessage}
      >
        {displayMessage}
      </p>

      {/* Elapsed time */}
      <span className="mt-1 text-xs tabular-nums" style={{ color: "var(--color-ink-50)" }}>
        {elapsedStr}
      </span>

      {/* Cancel button */}
      {isActive && (
        <div className="mt-4">
          <Button
            variant="secondary"
            size="sm"
            disabled={isCancelling}
            onClick={onCancel}
          >
            {isCancelling ? "Cancelling..." : "Cancel"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* Resume Skeleton - used when generation is in progress */
export function ResumeSkeleton() {
  return (
    <div className="h-full overflow-y-auto rounded-xl border p-5" style={{ background: "var(--color-white)", borderColor: "var(--color-border)" }}>
      {/* Header - Name */}
      <div className="animate-skeleton h-6 w-48 rounded mb-3" />

      {/* Contact line */}
      <div className="flex gap-3 mb-5">
        <div className="animate-skeleton h-3 w-24 rounded" style={{ animationDelay: "50ms" }} />
        <div className="animate-skeleton h-3 w-20 rounded" style={{ animationDelay: "100ms" }} />
        <div className="animate-skeleton h-3 w-28 rounded" style={{ animationDelay: "150ms" }} />
      </div>

      {/* Summary Section */}
      <div className="mb-5">
        <div className="animate-skeleton h-3.5 w-20 rounded mb-2" style={{ animationDelay: "200ms" }} />
        <div className="border-b pb-3 mb-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="animate-skeleton h-2.5 w-full rounded mb-1.5" style={{ animationDelay: "250ms" }} />
          <div className="animate-skeleton h-2.5 w-5/6 rounded mb-1.5" style={{ animationDelay: "300ms" }} />
          <div className="animate-skeleton h-2.5 w-4/5 rounded mb-1.5" style={{ animationDelay: "350ms" }} />
          <div className="animate-skeleton h-2.5 w-3/4 rounded" style={{ animationDelay: "375ms" }} />
        </div>
      </div>

      {/* Experience Section */}
      <div className="mb-5">
        <div className="animate-skeleton h-3.5 w-32 rounded mb-2" style={{ animationDelay: "400ms" }} />
        <div className="border-b pb-3 mb-3" style={{ borderColor: "var(--color-border)" }}>
          {/* Job 1 */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1.5">
              <div className="animate-skeleton h-3 w-40 rounded" style={{ animationDelay: "450ms" }} />
              <div className="animate-skeleton h-2.5 w-24 rounded" style={{ animationDelay: "500ms" }} />
            </div>
            <div className="animate-skeleton h-2.5 w-32 rounded mb-2" style={{ animationDelay: "550ms" }} />
            <div className="pl-3 space-y-1.5">
              <div className="animate-skeleton h-2 w-full rounded" style={{ animationDelay: "600ms" }} />
              <div className="animate-skeleton h-2 w-11/12 rounded" style={{ animationDelay: "650ms" }} />
              <div className="animate-skeleton h-2 w-4/5 rounded" style={{ animationDelay: "700ms" }} />
              <div className="animate-skeleton h-2 w-10/12 rounded" style={{ animationDelay: "720ms" }} />
            </div>
          </div>
          {/* Job 2 */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1.5">
              <div className="animate-skeleton h-3 w-36 rounded" style={{ animationDelay: "750ms" }} />
              <div className="animate-skeleton h-2.5 w-20 rounded" style={{ animationDelay: "800ms" }} />
            </div>
            <div className="animate-skeleton h-2.5 w-28 rounded mb-2" style={{ animationDelay: "850ms" }} />
            <div className="pl-3 space-y-1.5">
              <div className="animate-skeleton h-2 w-full rounded" style={{ animationDelay: "900ms" }} />
              <div className="animate-skeleton h-2 w-3/4 rounded" style={{ animationDelay: "950ms" }} />
              <div className="animate-skeleton h-2 w-5/6 rounded" style={{ animationDelay: "970ms" }} />
            </div>
          </div>
          {/* Job 3 */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1.5">
              <div className="animate-skeleton h-3 w-32 rounded" style={{ animationDelay: "1000ms" }} />
              <div className="animate-skeleton h-2.5 w-20 rounded" style={{ animationDelay: "1050ms" }} />
            </div>
            <div className="animate-skeleton h-2.5 w-24 rounded mb-2" style={{ animationDelay: "1100ms" }} />
            <div className="pl-3 space-y-1.5">
              <div className="animate-skeleton h-2 w-full rounded" style={{ animationDelay: "1150ms" }} />
              <div className="animate-skeleton h-2 w-2/3 rounded" style={{ animationDelay: "1200ms" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Skills Section */}
      <div className="mb-5">
        <div className="animate-skeleton h-3.5 w-16 rounded mb-2" style={{ animationDelay: "1250ms" }} />
        <div className="border-b pb-3 mb-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex flex-wrap gap-2 mb-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="animate-skeleton h-5 rounded-full"
                style={{
                  width: `${60 + Math.random() * 40}px`,
                  animationDelay: `${1300 + i * 50}ms`,
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[9, 10, 11, 12].map((i) => (
              <div
                key={i}
                className="animate-skeleton h-5 rounded-full"
                style={{
                  width: `${50 + Math.random() * 35}px`,
                  animationDelay: `${1750 + (i - 8) * 50}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Projects Section */}
      <div className="mb-5">
        <div className="animate-skeleton h-3.5 w-24 rounded mb-2" style={{ animationDelay: "2000ms" }} />
        <div className="border-b pb-3 mb-3" style={{ borderColor: "var(--color-border)" }}>
          {/* Project 1 */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1.5">
              <div className="animate-skeleton h-3 w-44 rounded" style={{ animationDelay: "2050ms" }} />
            </div>
            <div className="pl-3 space-y-1.5">
              <div className="animate-skeleton h-2 w-full rounded" style={{ animationDelay: "2100ms" }} />
              <div className="animate-skeleton h-2 w-4/5 rounded" style={{ animationDelay: "2150ms" }} />
              <div className="animate-skeleton h-2 w-3/4 rounded" style={{ animationDelay: "2200ms" }} />
            </div>
          </div>
          {/* Project 2 */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <div className="animate-skeleton h-3 w-36 rounded" style={{ animationDelay: "2250ms" }} />
            </div>
            <div className="pl-3 space-y-1.5">
              <div className="animate-skeleton h-2 w-full rounded" style={{ animationDelay: "2300ms" }} />
              <div className="animate-skeleton h-2 w-2/3 rounded" style={{ animationDelay: "2350ms" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Education Section */}
      <div className="mb-5">
        <div className="animate-skeleton h-3.5 w-24 rounded mb-2" style={{ animationDelay: "2400ms" }} />
        <div className="border-b pb-3 mb-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex justify-between items-center mb-1">
            <div className="animate-skeleton h-3 w-40 rounded" style={{ animationDelay: "2450ms" }} />
            <div className="animate-skeleton h-2.5 w-16 rounded" style={{ animationDelay: "2500ms" }} />
          </div>
          <div className="animate-skeleton h-2.5 w-32 rounded mb-1" style={{ animationDelay: "2550ms" }} />
          <div className="animate-skeleton h-2 w-24 rounded" style={{ animationDelay: "2600ms" }} />
        </div>
      </div>

      {/* Certifications Section */}
      <div>
        <div className="animate-skeleton h-3.5 w-28 rounded mb-2" style={{ animationDelay: "2650ms" }} />
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <div className="animate-skeleton h-2.5 w-48 rounded" style={{ animationDelay: "2700ms" }} />
            <div className="animate-skeleton h-2 w-16 rounded" style={{ animationDelay: "2750ms" }} />
          </div>
          <div className="flex justify-between items-center mb-1.5">
            <div className="animate-skeleton h-2.5 w-40 rounded" style={{ animationDelay: "2800ms" }} />
            <div className="animate-skeleton h-2 w-14 rounded" style={{ animationDelay: "2850ms" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
