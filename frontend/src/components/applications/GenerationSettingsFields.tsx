import { HStack } from "@astryxdesign/core/HStack";
import { Slider } from "@astryxdesign/core/Slider";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { VStack } from "@astryxdesign/core/VStack";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BaseResumeSummary } from "@/lib/api";
import { AGGRESSIVENESS_OPTIONS, PAGE_LENGTH_OPTIONS } from "@/lib/application-options";
import { InlineDetailField } from "./InlineDetailField";

export type GenerationSettingsFieldsProps = {
  baseResumes: BaseResumeSummary[];
  selectedResumeId: string | null;
  setSelectedResumeId: (value: string | null) => void;
  pageLength: string;
  onPageLengthChange: (value: string) => void;
  aggressiveness: string;
  onAggressivenessChange: (value: string) => void;
  additionalInstructions: string;
  onAdditionalInstructionsChange: (value: string) => void;
  disabled?: boolean;
};

export function GenerationSettingsFields({
  baseResumes,
  selectedResumeId,
  setSelectedResumeId,
  pageLength,
  onPageLengthChange,
  aggressiveness,
  onAggressivenessChange,
  additionalInstructions,
  onAdditionalInstructionsChange,
  disabled = false,
}: GenerationSettingsFieldsProps) {
  const baseResume = baseResumes.find((resume) => resume.id === selectedResumeId);
  const pageLengthOption = PAGE_LENGTH_OPTIONS.find((option) => option.value === pageLength);
  const aggressivenessIndex = AGGRESSIVENESS_OPTIONS.findIndex((option) => option.value === aggressiveness);
  const aggressivenessOption = AGGRESSIVENESS_OPTIONS[aggressivenessIndex];

  return (
    <VStack gap={0} className="generation-settings-fields">
      <InlineDetailField
        label="Base Resume"
        disabled={disabled || baseResumes.length === 0}
        value={baseResume
          ? `${baseResume.name}${baseResume.is_default ? " (default)" : ""}`
          : baseResumes.length === 0
            ? <Text type="supporting">Not specified. <Link to="/app/resumes">Create a resume</Link></Text>
            : ""}
      >
        <Select
          aria-label="Base Resume"
          disabled={disabled}
          value={selectedResumeId ?? ""}
          onChange={(event) => setSelectedResumeId(event.target.value || null)}
        >
          <option value="">Select a base resume</option>
          {baseResumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {resume.name}{resume.is_default ? " (default)" : ""}
            </option>
          ))}
        </Select>
      </InlineDetailField>

      <InlineDetailField
        label="Target Length"
        value={pageLengthOption?.label ?? ""}
        disabled={disabled}
      >
        <Select
          aria-label="Target Length"
          disabled={disabled}
          value={pageLength}
          onChange={(event) => onPageLengthChange(event.target.value)}
        >
          {PAGE_LENGTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </InlineDetailField>

      <VStack gap={1} className="application-detail-field generation-aggressiveness">
        <HStack justify="between" gap={2}>
          <Text type="supporting">Aggressiveness</Text>
          <Text type="supporting" color="primary" weight="medium">
            {aggressivenessOption?.label ?? "Not specified"}
          </Text>
        </HStack>
        <Slider
          label="Aggressiveness"
          isLabelHidden
          value={Math.max(0, aggressivenessIndex)}
          min={0}
          max={AGGRESSIVENESS_OPTIONS.length - 1}
          step={1}
          marks={AGGRESSIVENESS_OPTIONS.map((_, index) => ({ value: index }))}
          formatValue={(value: number) => AGGRESSIVENESS_OPTIONS[value]?.label ?? "Not specified"}
          valueDisplay="none"
          width="100%"
          isDisabled={disabled}
          onChange={(value: number) => onAggressivenessChange(AGGRESSIVENESS_OPTIONS[value].value)}
        />
        <HStack justify="between" gap={2} className="generation-aggressiveness-levels">
          {AGGRESSIVENESS_OPTIONS.map((option) => (
            <Tooltip
              key={option.value}
              placement="above"
              focusTrigger="always"
              touchTrigger="tap"
              hasHoverIndication={false}
              content={
                <VStack gap={2}>
                  <Text weight="medium" color="inherit">{option.description}</Text>
                  {option.details.map((detail) => (
                    <Text key={detail} type="supporting" color="inherit">{detail}</Text>
                  ))}
                </VStack>
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${option.label} aggressiveness`}
                aria-pressed={aggressiveness === option.value}
                disabled={disabled}
                onClick={() => onAggressivenessChange(option.value)}
              >
                {option.label}
              </Button>
            </Tooltip>
          ))}
        </HStack>
        {aggressivenessOption?.warning ? (
          <Text as="p" display="block" type="supporting" role="alert" className="generation-settings-warning">
            {aggressivenessOption.warning}
          </Text>
        ) : null}
      </VStack>

      <InlineDetailField
        label="Additional Instructions"
        value={additionalInstructions}
        multiline
        disabled={disabled}
      >
        <Textarea
          aria-label="Additional Instructions"
          className="text-sm"
          rows={3}
          disabled={disabled}
          placeholder="e.g., emphasize API architecture"
          value={additionalInstructions}
          onChange={(event) => onAdditionalInstructionsChange(event.target.value)}
        />
      </InlineDetailField>
    </VStack>
  );
}
