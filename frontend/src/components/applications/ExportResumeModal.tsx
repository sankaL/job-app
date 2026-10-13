import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, Download, FileDown, FileText } from "lucide-react";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@/components/ui/button";
import { ModalActions, ModalError, ModalShell } from "@/components/ui/modal-shell";
import type { ExportFormat, ExportStyleKey, ExportStyleOption } from "@/lib/api";
import { renderFilename, type FilenameValues } from "@/lib/exportFilename";
import { useExportStylesQuery } from "@/lib/queries";

const FALLBACK_STYLE: ExportStyleKey = "classic";

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word (DOCX)" },
];

type ExportResumeModalProps = {
  open: boolean;
  /** Last style the user exported with; null falls back to the catalogue default. */
  savedStyle: ExportStyleKey | null | undefined;
  filenameTemplate: string | null | undefined;
  filenameValues: FilenameValues;
  exportingFormat: ExportFormat | null;
  error: string | null;
  onClose: () => void;
  onExport: (format: ExportFormat, style: ExportStyleKey) => void;
};

function initialStyle(
  styles: ExportStyleOption[] | undefined,
  savedStyle: ExportStyleKey | null | undefined,
): ExportStyleKey {
  if (savedStyle && styles?.some((style) => style.key === savedStyle)) return savedStyle;
  return styles?.find((style) => style.is_default)?.key ?? FALLBACK_STYLE;
}

function StyleCard({
  style,
  selected,
  disabled,
  onSelect,
  buttonRef,
}: {
  style: ExportStyleOption;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${style.label} style`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      data-testid={`export-style-${style.key}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
        boxShadow: selected ? "0 0 0 2px var(--color-accent)" : undefined,
        background: "var(--color-background-surface)",
      }}
    >
      <div
        className="relative w-full overflow-hidden border-b"
        style={{
          aspectRatio: "8.5 / 11",
          borderColor: "var(--color-border)",
          background: "#ffffff",
        }}
      >
        <img
          src={`/export-styles/${style.key}.png`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover object-top"
        />
        {selected && (
          <span
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
            aria-hidden="true"
          >
            <Check size={14} />
          </span>
        )}
      </div>
      <div className="space-y-0.5 px-3 py-2.5">
        <Text
          as="p"
          display="block"
          type="body"
          className="font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          {style.label}
        </Text>
        <Text
          as="p"
          display="block"
          type="supporting"
          className="leading-snug"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {style.description}
        </Text>
      </div>
    </button>
  );
}

export function ExportResumeModal({
  open,
  savedStyle,
  filenameTemplate,
  filenameValues,
  exportingFormat,
  error,
  onClose,
  onExport,
}: ExportResumeModalProps) {
  const stylesQuery = useExportStylesQuery(open);
  const styles = stylesQuery.data;
  const [selectedStyle, setSelectedStyle] = useState<ExportStyleKey>(FALLBACK_STYLE);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const cardRefs = useRef(new Map<ExportStyleKey, HTMLButtonElement>());
  const exporting = exportingFormat !== null;

  // Re-seed the selection each time the dialog opens so it reflects the latest saved style.
  useEffect(() => {
    if (open) setSelectedStyle(initialStyle(styles, savedStyle));
  }, [open, styles, savedStyle]);

  function handleRadioKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!styles?.length) return;
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const index = styles.findIndex((style) => style.key === selectedStyle);
    const next = styles[(index + step + styles.length) % styles.length];
    setSelectedStyle(next.key);
    cardRefs.current.get(next.key)?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (exporting || !styles?.length) return;
    onExport(format, selectedStyle);
  }

  const filename = renderFilename(filenameTemplate, filenameValues, format);
  const loadError = stylesQuery.isError
    ? "Export styles could not be loaded. Close this dialog and try again."
    : null;

  return (
    <ModalShell
      open={open}
      title="Export Resume"
      description="Pick a style and format. Every style is a single-column layout that applicant tracking systems can read."
      icon={<FileDown size={14} aria-hidden="true" />}
      closeLabel="Close export dialog"
      onClose={onClose}
      closeDisabled={exporting}
      width="min(820px, calc(100vw - 32px))"
    >
      <form className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6" onSubmit={handleSubmit}>
        <div className="space-y-5">
          <div
            role="radiogroup"
            aria-label="Resume style"
            onKeyDown={handleRadioKeyDown}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          >
            {styles
              ? styles.map((style) => (
                  <StyleCard
                    key={style.key}
                    style={style}
                    selected={style.key === selectedStyle}
                    disabled={exporting}
                    onSelect={() => setSelectedStyle(style.key)}
                    buttonRef={(element) => {
                      if (element) cardRefs.current.set(style.key, element);
                      else cardRefs.current.delete(style.key);
                    }}
                  />
                ))
              : !stylesQuery.isError &&
                Array.from({ length: 5 }, (_, index) => (
                  <div
                    key={index}
                    aria-hidden="true"
                    className="animate-skeleton w-full rounded-xl"
                    style={{ aspectRatio: "8.5 / 13" }}
                  />
                ))}
          </div>

          <div className="space-y-2">
            <Text as="p" display="block" type="label" style={{ color: "var(--color-text-primary)" }}>
              Format
            </Text>
            <div
              role="radiogroup"
              aria-label="File format"
              className="grid w-full grid-cols-2 gap-1 rounded-xl border p-1"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-background-muted)",
              }}
            >
              {FORMAT_OPTIONS.map((option) => (
                <Button
                  variant="ghost"
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={format === option.value}
                  aria-pressed={format === option.value}
                  disabled={exporting}
                  onClick={() => setFormat(option.value)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 px-3 text-sm transition-all"
                  // Segmented toggle: the chosen format sits on a raised surface.
                  style={
                    format === option.value
                      ? {
                          background: "var(--color-background-surface)",
                          color: "var(--color-text-primary)",
                          boxShadow: "0 1px 3px var(--color-shadow)",
                          fontWeight: 600,
                        }
                      : { background: "transparent", color: "var(--color-text-secondary)" }
                  }
                >
                  <FileText size={14} aria-hidden="true" />
                  <span>{option.label}</span>
                </Button>
              ))}
            </div>
          </div>

          <div
            className="rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--color-border)", background: "var(--color-background-muted)" }}
          >
            <Text as="p" display="block" type="supporting" style={{ color: "var(--color-text-secondary)" }}>
              Downloads as
            </Text>
            <Text
              as="p"
              display="block"
              type="body"
              className="break-all font-semibold"
              data-testid="export-filename-preview"
              style={{ color: "var(--color-text-primary)" }}
            >
              {filename}
            </Text>
            {format === "docx" && (
              <Text
                as="p"
                display="block"
                type="supporting"
                className="mt-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Word files use common Office fonts, so spacing can differ slightly from the preview.
              </Text>
            )}
          </div>

          <ModalError message={error ?? loadError} />
        </div>
        <ModalActions
          onCancel={onClose}
          submitting={exporting}
          submitLabel={
            <>
              {!exporting && <Download size={14} aria-hidden="true" />}
              {exporting ? "Exporting…" : `Download ${format === "pdf" ? "PDF" : "DOCX"}`}
            </>
          }
        />
      </form>
    </ModalShell>
  );
}
