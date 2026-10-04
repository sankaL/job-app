import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "./button";
import { STALLED_MESSAGE } from "./resume-processing";
import { useProcessingClock } from "./use-processing-clock";
import type { ExtractionProgress } from "@/lib/api";

export function SectionRegenerationProgress({ progress, isOptimistic, isActive, isCancelling, onCancel }: {
  progress: ExtractionProgress | null;
  isOptimistic: boolean;
  isActive: boolean;
  isCancelling: boolean;
  onCancel: () => void;
}) {
  const reported = isOptimistic ? null : progress;
  const percent = reported?.percent_complete;
  const value = typeof percent === "number" && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent)) : undefined;
  const terminal = Boolean(reported?.completed_at || reported?.terminal_error_code);
  const { stalled } = useProcessingClock({
    active: (isActive || isOptimistic) && !terminal,
    sessionKey: reported?.job_id ?? "optimistic",
    startedAt: reported?.created_at, updatedAt: reported?.updated_at,
    updateKey: `${reported?.message ?? ""}|${value ?? ""}`,
  });
  return (
    <VStack gap={4} className="py-4" data-testid="section-regeneration-progress">
      <HStack gap={3} vAlign="center" hAlign="between">
        <Text as="p" type="supporting" color="secondary" role="status" aria-label="Section regeneration status" aria-live="polite" aria-atomic="true">
          {isCancelling ? "Stopping this update. Waiting for confirmation." : reported?.message || "Preparing this section using your instructions and source resume."}
        </Text>
        {isActive && !terminal && (
          <Button size="sm" variant="ghost" disabled={isCancelling} onClick={onCancel}>
            {isCancelling ? "Cancelling..." : "Cancel"}
          </Button>
        )}
      </HStack>
      <ProgressBar label="Section regeneration progress" isLabelHidden variant="neutral" value={value} isIndeterminate={value === undefined && !terminal} hasValueLabel={value !== undefined} />
      {stalled && <Text as="p" type="supporting" role="status" aria-label="Slow progress notice" aria-live="polite">{isActive && !isCancelling ? `${STALLED_MESSAGE} You can stop and try again.` : STALLED_MESSAGE}</Text>}
      <VStack gap={3} aria-hidden="true">
        <Skeleton width="92%" height="var(--spacing-2)" radius={1} />
        <Skeleton width="100%" height="var(--spacing-2)" radius={1} index={1} />
        <Skeleton width="74%" height="var(--spacing-2)" radius={1} index={2} />
      </VStack>
    </VStack>
  );
}
