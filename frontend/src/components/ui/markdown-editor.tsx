import { useMemo, useRef, type TextareaHTMLAttributes, type UIEvent } from "react";
import { cn } from "@/lib/utils";

type MarkdownEditorProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  value: string;
};

function getHeadingClass(line: string) {
  if (/^#\s+/.test(line)) return "heading-1";
  if (/^##\s+/.test(line)) return "heading-2";
  if (/^###\s+/.test(line)) return "heading-3";
  return "body-line";
}

export function MarkdownEditor({
  className,
  placeholder,
  onScroll,
  value,
  ...props
}: MarkdownEditorProps) {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const hasContent = value.length > 0;

  const highlightedLines = useMemo(() => {
    const source = hasContent ? value : " ";
    const lines = source.split("\n");
    return lines.map((line, index) => {
      const displayLine = line.length > 0 ? line : "\u200B";
      return (
        <span key={`${index}-${line.length}`} className={cn("markdown-editor-line", getHeadingClass(line))}>
          {displayLine}
          {index < lines.length - 1 ? "\n" : ""}
        </span>
      );
    });
  }, [hasContent, value]);

  function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    onScroll?.(event);
  }

  return (
    <div className={cn("markdown-editor", className)}>
      <pre ref={highlightRef} className="markdown-editor-highlight" aria-hidden="true">
        {highlightedLines}
      </pre>
      {!hasContent && placeholder ? (
        <div className="markdown-editor-placeholder" aria-hidden="true">
          {placeholder}
        </div>
      ) : null}
      <textarea
        {...props}
        value={value}
        onScroll={handleScroll}
        className="markdown-editor-input"
      />
    </div>
  );
}
