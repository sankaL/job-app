import { ResumeGenerationSkeleton } from "./resume-generation-skeleton";
import { Button } from "@/components/ui/button";
import { ResumeProcessing } from "@/components/ui/resume-processing";
import type { ExtractionProgress } from "@/lib/api";

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
  const sessionKey = isActive || isOptimistic ? `${reported?.workflow_kind ?? "optimistic"}:${reported?.job_id ?? "optimistic"}` : "inactive";
  return <ResumeProcessing title={section ? "Updating your resume section" : "Preparing your tailored resume"}
    preview={<ResumeGenerationSkeleton section={section} backdrop sections={terminal ? [] : reported?.partial_sections ?? []} />}
    message={message} percent={reported?.percent_complete} easeProgress
    startedAt={reported?.created_at} updatedAt={reported?.updated_at}
    stalledHint={isActive && !isCancelling ? "You can stop and try again." : undefined}
    messages={isCancelling ? ["Your current draft stays available while cancellation is confirmed."] : undefined}
    active={(isActive || isOptimistic) && !terminal} sessionKey={sessionKey}
    actions={isActive && !terminal ? <Button type="button" variant="secondary" size="sm" disabled={isCancelling} onClick={onCancel}>{isCancelling ? "Cancelling..." : "Cancel"}</Button> : undefined} />;
}
