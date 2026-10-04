import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import type { ReactNode } from "react";
import { Button } from "./button";
import { ResumeGenerationSkeleton } from "./resume-generation-skeleton";
import { useEasedProgress } from "./use-eased-progress";
import { useProcessingClock } from "./use-processing-clock";
import { ProcessingAvatar } from "./processing-avatar";

const DEFAULT_MESSAGES = [
  "Your experience guides the draft. Every claim stays tied to your source resume.",
  "The job requirements help focus your most relevant experience and skills.",
  "Employers, dates and qualifications are checked against your original resume.",
  "You'll be able to review and edit the result before using it.",
];

export const STALLED_MESSAGE = "This is taking longer than usual.";

export function ResumeProcessing({ title, message, percent, easeProgress = false, startedAt, updatedAt, stalledHint, active = true, sessionKey = "import", provisional = false, actions, preview, messages = DEFAULT_MESSAGES, statusLabel = "Resume processing status", progressLabel = "Resume processing progress" }: {
  title: string;
  message: string;
  percent?: number;
  /** Ease toward the higher of elapsed-time feedback (capped at 94%) and reported progress. */
  easeProgress?: boolean;
  /** Job start time from the server, so the elapsed clock survives reloads and navigation. */
  startedAt?: string | null;
  /** Last server progress update, used to detect a slow job. */
  updatedAt?: string | null;
  /** Optional next step appended to the slow-job notice. */
  stalledHint?: string;
  active?: boolean;
  sessionKey?: string;
  /** The session key is a placeholder until the server reports the job. */
  provisional?: boolean;
  actions?: ReactNode;
  preview?: ReactNode;
  messages?: readonly string[];
  statusLabel?: string;
  progressLabel?: string;
}) {
  const { elapsed, stalled } = useProcessingClock({ active, sessionKey, startedAt, updatedAt, updateKey: `${message}|${percent ?? ""}` });
  const measuredPercent = typeof percent === "number" && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent)) : undefined;
  const eased = useEasedProgress({ enabled: easeProgress && active, sessionKey, startedAt, reported: measuredPercent, provisional });
  const shownPercent = eased ?? measuredPercent;
  const elapsedText = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
  const supportingMessage = messages.length ? messages[Math.floor(elapsed / 8) % messages.length] : undefined;

  return (
    <VStack as="section" aria-label={title} data-active={active} className={`resume-processing relative isolate min-h-96 h-full w-full flex-1 overflow-hidden rounded-lg bg-processing-surface motion-reduce:[&_.astryx-skeleton]:animate-none ${!active ? "[&_.astryx-skeleton]:animate-none" : ""}`}>
      <VStack aria-hidden="true" className="pointer-events-none select-none" padding={8}>
        {preview ?? <ResumeGenerationSkeleton backdrop />}
      </VStack>
      <VStack className="absolute inset-0 p-4 sm:p-8" hAlign="center" vAlign="center">
        <VStack gap={3} hAlign="center" className="w-full max-w-xs rounded-lg bg-processing-surface p-4 text-center sm:p-5">
          <ProcessingAvatar active={active} />
          <Heading level={2} className="text-base font-semibold">{title}</Heading>
          <VStack gap={3} className="w-full">
            <Text as="p" type="body" role="status" aria-label={statusLabel} aria-live="polite" aria-atomic="true">{message}</Text>
            <ProgressBar label={progressLabel} isLabelHidden value={shownPercent} isIndeterminate={shownPercent === undefined && active} hasValueLabel={shownPercent !== undefined} variant="neutral" isDisabled={!active} />
            <Text as="p" type="supporting" color="secondary" className="min-h-10" aria-live="off">{supportingMessage}</Text>
            {stalled && <Text as="p" type="supporting" role="status" aria-label="Slow progress notice" aria-live="polite">{stalledHint ? `${STALLED_MESSAGE} ${stalledHint}` : STALLED_MESSAGE}</Text>}
          </VStack>
          <HStack gap={3} hAlign="center" vAlign="center">
            <Text type="supporting" color="secondary" aria-label="Elapsed time" className="tabular-nums">{elapsedText}</Text>
            {actions}
          </HStack>
        </VStack>
      </VStack>
    </VStack>
  );
}

export function ResumeImportProgress({ useAi }: { useAi: boolean }) {
  return <ResumeProcessing title="Reading and structuring your resume"
    message={useAi ? "Importing your PDF with AI assistance." : "Importing your PDF without AI entry extraction."}
    messages={[
      "Your PDF is the source for your resume sections and role details.",
      useAi ? "AI helps organize roles, dates and duties from your PDF." : "Local parsing keeps unclear role details as source text for your review.",
      "Your original text stays available for comparison.",
      "Your sections will open here when the import is ready.",
    ]} />;
}

export function JobExtractionProgress({ progress, isCancelling, onCancel }: {
  progress: { job_id: string; message: string; percent_complete: number; created_at?: string; updated_at?: string } | null;
  isCancelling: boolean;
  onCancel?: () => void;
}) {
  return <ResumeProcessing title="Reading the job posting" sessionKey={progress?.job_id ?? "extraction"} provisional={!progress}
    message={isCancelling ? "Stopping extraction. Waiting for confirmation." : progress?.message || "Opening the job posting. Waiting for the first update."}
    percent={progress?.percent_complete} easeProgress startedAt={progress?.created_at} updatedAt={progress?.updated_at}
    stalledHint={onCancel && !isCancelling ? "You can stop extraction and enter the details yourself." : undefined}
    statusLabel="Job extraction status" progressLabel="Job extraction progress"
    actions={onCancel ? <Button type="button" variant="secondary" size="sm" disabled={isCancelling} onClick={onCancel}>{isCancelling ? "Stopping..." : "Stop extraction"}</Button> : undefined}
    messages={isCancelling ? ["You can enter the job details yourself after extraction stops."] : [
      "The posting is the source for the role, company and job requirements.",
      "Relevant skills and responsibilities help shape your tailored resume.",
      "You'll be able to review the extracted details before generating a resume.",
      "Some job sites take longer to respond. You can stop extraction at any time.",
    ]} />;
}
