import { useState } from "react";
import { HStack } from "@astryxdesign/core/HStack";
import { Slider } from "@astryxdesign/core/Slider";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { VStack } from "@astryxdesign/core/VStack";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { ProcessingAvatar } from "@/components/ui/processing-avatar";
import { AGGRESSIVENESS_OPTIONS } from "@/lib/application-options";

const HIGH = AGGRESSIVENESS_OPTIONS[AGGRESSIVENESS_OPTIONS.length - 1];

export type AggressivenessStripProps = {
  aggressiveness: string;
  /** Called once the level should change; the page saves it immediately. */
  onAggressivenessChange: (value: string) => void;
  disabled?: boolean;
  /** True while the latest change is being saved. */
  isSaving?: boolean;
};

/**
 * The prominent aggressiveness control at the top of the application details.
 * High rewrites content beyond the source resume, so it applies only after the
 * user accepts the risk in a confirmation dialog.
 */
export function AggressivenessStrip({
  aggressiveness,
  onAggressivenessChange,
  disabled = false,
  isSaving = false,
}: AggressivenessStripProps) {
  const [confirmingHigh, setConfirmingHigh] = useState(false);
  // The thumb follows a drag locally; the level is chosen (and saved) only when the drag ends,
  // so dragging Low to High does not save Medium on the way or open the High dialog mid-drag.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const index = AGGRESSIVENESS_OPTIONS.findIndex((option) => option.value === aggressiveness);
  const option = AGGRESSIVENESS_OPTIONS[index];
  const level = option?.value ?? "medium";

  function select(value: string) {
    if (value === aggressiveness) return;
    if (value === HIGH.value) {
      setConfirmingHigh(true);
      return;
    }
    onAggressivenessChange(value);
  }

  return (
    <section
      aria-label="Aggressiveness"
      className={`aggressiveness-strip aggressiveness-strip--${level}`}
      data-level={level}
      aria-busy={isSaving}
    >
      <VStack gap={2}>
        <HStack justify="between" vAlign="center" gap={2}>
          <Text type="label" weight="semibold" className="aggressiveness-strip-title">Aggressiveness</Text>
          {/* The badge names the level; its tooltip carries the level's full behaviour. */}
          <Tooltip
            placement="below"
            focusTrigger="always"
            touchTrigger="tap"
            hasHoverIndication={false}
            content={option ? (
              <VStack gap={2}>
                <Text weight="medium" color="inherit">{option.description}</Text>
                {option.details.map((detail) => (
                  <Text key={detail} type="supporting" color="inherit">{detail}</Text>
                ))}
              </VStack>
            ) : "Not specified"}
          >
            <button type="button" className="aggressiveness-strip-badge" aria-label={`${option?.label ?? "Unknown"} aggressiveness details`}>
              {option?.label ?? "Not specified"}
            </button>
          </Tooltip>
        </HStack>
        {option ? <Text type="supporting" className="aggressiveness-strip-description">{option.description}</Text> : null}
        <Slider
          label="Aggressiveness"
          isLabelHidden
          value={dragIndex ?? Math.max(0, index)}
          min={0}
          max={AGGRESSIVENESS_OPTIONS.length - 1}
          step={1}
          marks={AGGRESSIVENESS_OPTIONS.map((_, markIndex) => ({ value: markIndex }))}
          formatValue={(value: number) => AGGRESSIVENESS_OPTIONS[value]?.label ?? "Not specified"}
          valueDisplay="none"
          width="100%"
          isDisabled={disabled}
          onChange={(value: number) => setDragIndex(value)}
          onChangeEnd={(value: number) => {
            setDragIndex(null);
            select(AGGRESSIVENESS_OPTIONS[value].value);
          }}
        />
      </VStack>
      <ConfirmModal
        open={confirmingHigh}
        title="Use High aggressiveness?"
        illustration={<ProcessingAvatar active className="h-20 w-20 text-[var(--color-text-primary)]" />}
        message={HIGH.warning}
        confirmLabel="I accept the risk"
        cancelLabel={`Keep ${option?.label ?? "current level"}`}
        onConfirm={() => {
          setConfirmingHigh(false);
          onAggressivenessChange(HIGH.value);
        }}
        onCancel={() => setConfirmingHigh(false)}
      />
    </section>
  );
}
