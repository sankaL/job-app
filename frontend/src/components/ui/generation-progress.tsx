import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ExtractionProgress } from "@/lib/api";

type GenerationProgressProps = {
  progress: ExtractionProgress | null;
  isOptimistic: boolean;
  isActive: boolean;
  isCancelling: boolean;
  onCancel: () => void;
};

const STAGE_MESSAGES = [
  "Analyzing job requirements and key qualifications…",
  "Mapping your experience to the job description…",
  "Identifying matching skills and competencies…",
  "Structuring resume sections for maximum impact…",
  "Tailoring bullet points to highlight relevant experience…",
  "Optimizing keyword alignment with the job posting…",
  "Formatting sections and ensuring length targets…",
  "Running quality validation checks…",
  "Finalizing your tailored resume…",
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

  // Rotate stage messages every 6 seconds when no real progress message
  useEffect(() => {
    if (!isOptimistic && progress?.message) return;

    const interval = setInterval(() => {
      setStageIndex((i) => (i + 1) % STAGE_MESSAGES.length);
    }, 6000);

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
    <Card variant="success" className="animate-fadeIn">
      <div className="flex items-center justify-between">
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-spruce)" }}
        >
          Resume Generation
        </h3>
        <span className="text-xs tabular-nums" style={{ color: "var(--color-ink-40)" }}>
          {elapsedStr}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="mt-3 h-2 overflow-hidden rounded-full"
        style={{ background: "var(--color-spruce-10)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${percentComplete}%`,
            background: "var(--color-spruce)",
            backgroundImage:
              percentComplete < 100
                ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)"
                : "none",
            backgroundSize: "200% 100%",
            animation: percentComplete < 100 ? "progressPulse 2s linear infinite" : "none",
          }}
        />
      </div>

      {/* Status message */}
      <p
        className="mt-3 text-sm font-medium animate-fadeIn"
        style={{ color: "var(--color-ink)" }}
        key={displayMessage}
      >
        {displayMessage}
      </p>

      {/* Skeleton preview of resume being built */}
      <div className="mt-4 grid gap-2 rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }}>
        <div className="animate-skeleton h-3 w-1/3 rounded" />
        <div className="animate-skeleton h-2 w-full rounded" style={{ animationDelay: "100ms" }} />
        <div className="animate-skeleton h-2 w-4/5 rounded" style={{ animationDelay: "200ms" }} />
        <div className="mt-2 animate-skeleton h-3 w-1/4 rounded" style={{ animationDelay: "300ms" }} />
        <div className="animate-skeleton h-2 w-full rounded" style={{ animationDelay: "400ms" }} />
        <div className="animate-skeleton h-2 w-3/4 rounded" style={{ animationDelay: "500ms" }} />
      </div>

      {/* Cancel button */}
      {isActive && (
        <div className="mt-4">
          <Button
            variant="secondary"
            size="sm"
            disabled={isCancelling}
            onClick={onCancel}
          >
            {isCancelling ? "Cancelling…" : "Cancel Generation"}
          </Button>
        </div>
      )}
    </Card>
  );
}
