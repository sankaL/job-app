import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

type InlineDetailFieldProps = {
  label: string;
  value: ReactNode;
  children: ReactNode;
  multiline?: boolean;
  disabled?: boolean;
};

export function InlineDetailField({
  label,
  value,
  children,
  multiline = false,
  disabled = false,
}: InlineDetailFieldProps) {
  const labelId = useId();
  const valueId = useId();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fieldRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const wasEditing = useRef(false);
  const hasValue = value != null && value !== false && (typeof value !== "string" || value.trim().length > 0);

  useEffect(() => {
    if (editing) {
      editorRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not([aria-hidden="true"]):not(:disabled), [role="combobox"]:not([aria-disabled="true"]), button:not(:disabled)',
      )?.focus();
    } else if (wasEditing.current) {
      fieldRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  return (
    <VStack
      ref={fieldRef}
      gap={1}
      role="group"
      aria-labelledby={labelId}
      className="application-detail-field min-w-0"
      onKeyDown={(event) => {
        if (editing && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setEditing(false);
        }
      }}
    >
      <HStack gap={2} vAlign="center" hAlign="between">
        <Text id={labelId} type="supporting" className="application-detail-field-label">
          {label}
        </Text>
        <IconButton
          type="button"
          aria-label={editing ? `Done editing ${label}` : `Edit ${label}`}
          title={editing ? `Done editing ${label}` : `Edit ${label}`}
          disabled={disabled && !editing}
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? <Check size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
        </IconButton>
      </HStack>
      {editing ? (
        <VStack ref={editorRef} gap={2} className="application-detail-field-editor">
          {children}
        </VStack>
      ) : (
        <>
          <Text
            id={valueId}
            as="p"
            display="block"
            type="body"
            color={hasValue ? "primary" : "secondary"}
            maxLines={multiline && !expanded ? 3 : 0}
            hasTruncateTooltip={false}
            className="application-detail-field-value whitespace-pre-line break-words"
          >
            {hasValue ? value : "Not specified"}
          </Text>
          {multiline && hasValue && (
            <HStack>
              <Button
                type="button"
                variant="ghost"
                      aria-label={`${expanded ? "View less" : "View more"} ${label}`}
                aria-expanded={expanded}
                aria-controls={valueId}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "View less" : "View more"}
              </Button>
            </HStack>
          )}
        </>
      )}
    </VStack>
  );
}
