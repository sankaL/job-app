import { useId, useRef } from "react";
import { Text } from "@astryxdesign/core/Text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProfileData } from "@/lib/api";
import {
  buildFilenameValues,
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_PLACEHOLDERS,
  MAX_FILENAME_TEMPLATE_LENGTH,
  renderFilename,
  validateFilenameTemplate,
} from "@/lib/exportFilename";

const EXAMPLE_COMPANY = "Acme";
const EXAMPLE_JOB_TITLE = "Product Manager";

type ExportFilenameFieldProps = {
  value: string;
  onChange: (value: string) => void;
  profile: ProfileData | null;
  disabled?: boolean;
};

/** File name used for every resume exported from applications built on this base resume. */
export function ExportFilenameField({ value, onChange, profile, disabled }: ExportFilenameFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const validationError = validateFilenameTemplate(value);
  const example = renderFilename(
    value,
    buildFilenameValues({
      fullName: profile?.name,
      firstName: profile?.first_name,
      lastName: profile?.last_name,
      company: EXAMPLE_COMPANY,
      jobTitle: EXAMPLE_JOB_TITLE,
    }),
    "pdf",
  );

  function insertPlaceholder(placeholder: string) {
    const token = `{${placeholder}}`;
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const spacer = before && !before.endsWith(" ") ? " " : "";
    const next = `${before}${spacer}${token}${after}`.slice(0, MAX_FILENAME_TEMPLATE_LENGTH);
    onChange(next);
    requestAnimationFrame(() => {
      const caret = Math.min(next.length, before.length + spacer.length + token.length);
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="space-y-2" data-testid="export-filename-field">
      <Label htmlFor={inputId}>Download file name</Label>
      <Input
        id={inputId}
        ref={inputRef}
        value={value}
        maxLength={MAX_FILENAME_TEMPLATE_LENGTH}
        placeholder={DEFAULT_FILENAME_TEMPLATE}
        disabled={disabled}
        aria-describedby={hintId}
        aria-invalid={validationError ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex flex-wrap gap-1.5" aria-label="Insert placeholder">
        {FILENAME_PLACEHOLDERS.map((placeholder) => (
          <button
            key={placeholder}
            type="button"
            disabled={disabled}
            onClick={() => insertPlaceholder(placeholder)}
            className="rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-background-muted)",
              color: "var(--color-text-secondary)",
            }}
          >
            {`{${placeholder}}`}
          </button>
        ))}
      </div>
      <Text
        as="p"
        display="block"
        type="supporting"
        id={hintId}
        style={{ color: validationError ? "var(--color-error)" : "var(--color-text-secondary)" }}
      >
        {validationError ??
          `Used for resumes exported from applications built on this resume. Example: ${example}`}
      </Text>
    </div>
  );
}
