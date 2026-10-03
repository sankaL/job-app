import { Input } from "@/components/ui/input";
import { useEffect, useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import "./resume-workbench.css";

export function ResumePdfInput({
  file,
  disabled,
  onChange,
  onError,
}: {
  file: File | null;
  disabled: boolean;
  onChange: (file: File) => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (disabled) {
      depth.current = 0;
      setDragging(false);
    }
  }, [disabled]);
  function selectFiles(files: FileList | File[]) {
    if (disabled || !files.length) return false;
    if (files.length !== 1) {
      onError("Choose one PDF file at a time.");
      return false;
    }
    const selected = files[0];
    if (
      !/\.pdf$/i.test(selected.name) ||
      (selected.type && selected.type !== "application/pdf")
    ) {
      onError("Choose a PDF file.");
      return false;
    }
    onChange(selected);
    return true;
  }
  return (
    <label
      htmlFor={id}
      className="resume-pdf-drop"
      data-dragging={dragging}
      data-disabled={disabled}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) {
          depth.current += 1;
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        selectFiles(event.dataTransfer.files);
      }}
    >
      <Input
        id={id}
        className="sr-only"
        aria-label="PDF File"
        type="file"
        accept=".pdf,application/pdf"
        disabled={disabled}
        onChange={(event) => {
          if (event.target.files && !selectFiles(event.target.files))
            event.target.value = "";
        }}
      />
      <Upload size={24} aria-hidden="true" />
      <span className="resume-pdf-prompt">
        Drag your PDF here or <span>choose a file</span>
      </span>
      <span className="resume-pdf-filename" aria-live="polite">
        {file?.name ?? "PDF files only"}
      </span>
    </label>
  );
}
