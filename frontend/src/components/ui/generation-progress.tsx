import { Button } from "@/components/ui/button";
import { ResumeProcessing } from "@/components/ui/resume-processing";
import type { ExtractionProgress } from "@/lib/api";

type GenerationProgressProps = {
  progress: ExtractionProgress | null;
  isOptimistic: boolean;
  isActive: boolean;
  isCancelling: boolean;
  onCancel: () => void;
};

const GENERATION_STEPS = [
  { title: "Prepare the source and job requirements", detail: "Use your reviewed sections, job posting and saved tailoring settings." },
  { title: "Write the tailored sections", detail: "Prioritize relevant experience and skills while keeping claims grounded in your source." },
  { title: "Check facts and structure", detail: "Validate employers, dates, source references and section structure. Repair rejected content when possible." },
  { title: "Assemble your editable draft", detail: "Bring the accepted sections together and attach profile details locally." },
];

export function GenerationProgress({ progress, isOptimistic, isActive, isCancelling, onCancel }: GenerationProgressProps) {
  const reported = isOptimistic ? null : progress;
  const hasReportedProgress = Boolean(reported);
  const terminal = Boolean(reported?.completed_at || reported?.terminal_error_code);
  const percent = reported?.percent_complete;
  const message = isCancelling ? "Stopping this generation. Waiting for confirmation." : hasReportedProgress && reported?.message ? reported.message : "Sending your generation request. Waiting for the first processing update.";
  const currentStep = !hasReportedProgress || terminal || typeof percent !== "number" || !Number.isFinite(percent) ? null
    : /assembl|merg/i.test(message) || percent >= 95 ? 3
    : /validat|audit|check|repair/i.test(message) || percent >= 85 ? 2
    : percent >= 10 ? 1 : 0;
  const sessionKey = isActive || isOptimistic ? `${reported?.workflow_kind ?? "optimistic"}:${reported?.job_id ?? "optimistic"}` : "inactive";
  return <ResumeProcessing title="Preparing your tailored resume" description="Your reviewed experience is being tailored to this job, then checked before the draft is saved."
    message={message} steps={GENERATION_STEPS} currentStep={isCancelling ? null : currentStep} percent={percent}
    active={(isActive || isOptimistic) && !terminal} sessionKey={sessionKey}
    actions={isActive && !terminal ? <Button type="button" variant="secondary" size="sm" disabled={isCancelling} onClick={onCancel}>{isCancelling ? "Cancelling..." : "Cancel"}</Button> : undefined} />;
}
