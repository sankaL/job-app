import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

type InfoPopoverProps = {
  label: string;
  children: ReactNode;
};

export function InfoPopover({ label, children }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors"
        style={{
          borderColor: open ? "var(--color-spruce)" : "var(--color-border)",
          background: open ? "var(--color-spruce-05)" : "var(--color-white)",
          color: open ? "var(--color-spruce)" : "var(--color-ink-50)",
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <Info size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border p-3 shadow-lg"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-white)",
            boxShadow: "var(--shadow-panel)",
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
