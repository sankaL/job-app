import { ResumeGenerationSkeleton } from "./resume-generation-skeleton";
import { Button } from "@/components/ui/button";
import { ResumeProcessing } from "@/components/ui/resume-processing";
import { useState } from "react";
import type { ExtractionProgress, PartialSection } from "@/lib/api";

type GenerationProgressProps = {
  progress: ExtractionProgress | null;
  isOptimistic: boolean;
  isActive: boolean;
  isCancelling: boolean;
  onCancel: () => void;
  scope?: "resume" | "section";
};

export function GenerationProgress({ progress, isOptimistic, isActive, isCancelling, onCancel, scope = "resume" }: GenerationProgressProps) {
  const reported = isOptimistic ? null : progress;
  const section = reported ? reported.workflow_kind === "regeneration_section" : scope === "section";
  const terminal = Boolean(reported?.completed_at || reported?.terminal_error_code);
  const message = isCancelling ? "Stopping this generation. Waiting for confirmation." : reported?.message || "Sending your generation request. Waiting for the first processing update.";
  // Keyed by job, so the clock and bar don't reset in the moment between completion and the draft appearing.
  const sessionKey = reported ? `${reported.workflow_kind}:${reported.job_id}` : isOptimistic ? "optimistic:optimistic" : "inactive";
  const live = reported?.partial_sections ?? [];
  // The final "completed" update carries no sections; keep the last verified ones (and the strip)
  // until the finished draft replaces this view, instead of flashing back to the centred card.
  const [kept, setKept] = useState<{ jobId: string; sections: readonly PartialSection[] } | null>(null);
  if (reported && live.length && (kept?.jobId !== reported.job_id || kept.sections !== live)) {
    setKept({ jobId: reported.job_id, sections: live });
  }
  const failed = Boolean(reported?.terminal_error_code);
  const ready = failed ? [] : live.length ? live : kept && kept.jobId === reported?.job_id ? kept.sections : [];
  // Once verified sections arrive, the progress card moves into a strip above them so it stops covering them.
  return <ResumeProcessing title={section ? "Updating your resume section" : "Preparing your tailored resume"}
    layout={ready.length ? "strip" : "card"}
    preview={<ResumeGenerationSkeleton section={section} backdrop sections={ready} />}
    message={message} percent={reported?.percent_complete} easeProgress
    startedAt={reported?.created_at} updatedAt={reported?.updated_at}
    stalledHint={isActive && !isCancelling ? "You can stop and try again." : undefined}
    messages={isCancelling ? ["Your current draft stays available while cancellation is confirmed."] : undefined}
    active={(isActive || isOptimistic) && !terminal} sessionKey={sessionKey} provisional={!reported}
    actions={isActive && !terminal ? <Button type="button" variant="secondary" size="sm" disabled={isCancelling} onClick={onCancel}>{isCancelling ? "Cancelling..." : "Cancel"}</Button> : undefined} />;
}
