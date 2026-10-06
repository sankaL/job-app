import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Link } from "react-router-dom";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BaseResumeSummary } from "@/lib/api";
import { PAGE_LENGTH_OPTIONS } from "@/lib/application-options";
import { InlineDetailField } from "./InlineDetailField";

export type GenerationSettingsFieldsProps = {
  baseResumes: BaseResumeSummary[];
  selectedResumeId: string | null;
  setSelectedResumeId: (value: string | null) => void;
  pageLength: string;
  onPageLengthChange: (value: string) => void;
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
  additionalInstructions,
  onAdditionalInstructionsChange,
  disabled = false,
}: GenerationSettingsFieldsProps) {
  const baseResume = baseResumes.find((resume) => resume.id === selectedResumeId);
  const pageLengthOption = PAGE_LENGTH_OPTIONS.find((option) => option.value === pageLength);

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
