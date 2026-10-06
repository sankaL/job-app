import { PopoverSurface } from "@/components/ui/card";
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
        className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-background-muted)]"
        style={{ color: "var(--color-text-secondary)" }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      {open ? (
        <PopoverSurface
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-2 w-72 rounded-xl border p-3 shadow-[var(--shadow-high)]"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {children}
        </PopoverSurface>
      ) : null}
    </div>
  );
}
