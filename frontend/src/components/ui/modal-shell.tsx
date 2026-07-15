import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ModalShellProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  icon: ReactNode;
  closeLabel: string;
  onClose: () => void;
  closeDisabled?: boolean;
  width?: string;
  children: ReactNode;
};

export function ModalShell({
  open,
  title,
  description,
  icon,
  closeLabel,
  onClose,
  closeDisabled = false,
  width = "min(520px, calc(100vw - 32px))",
  children,
}: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: "rgba(16, 24, 40, 0.48)",
          backdropFilter: "blur(6px)",
          animation: "fadeIn 220ms var(--ease-out) both",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="animate-scaleIn relative z-[1] overflow-hidden"
        style={{
          width,
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--color-border)",
          background: "var(--color-white)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        <div
          className="flex items-start justify-between gap-4 px-6 pb-4 pt-6"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: "var(--color-spruce)", color: "white" }}
              >
                {icon}
              </div>
              <h2 id={titleId} className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>
                {title}
              </h2>
            </div>
            <p id={descriptionId} className="text-sm leading-relaxed" style={{ color: "var(--color-ink-50)" }}>
              {description}
            </p>
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            disabled={closeDisabled}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: "var(--color-ink-40)", background: "transparent", borderColor: "var(--color-border)" }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="rounded-xl border px-4 py-3 text-sm"
      style={{
        color: "var(--color-ember)",
        borderColor: "var(--color-ember-10)",
        background: "var(--color-ember-05)",
      }}
    >
      {message}
    </div>
  );
}

type ModalActionsProps = {
  onCancel: () => void;
  submitting: boolean;
  submitLabel: ReactNode;
};

export function ModalActions({ onCancel, submitting, submitLabel }: ModalActionsProps) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t pt-5" style={{ borderColor: "var(--color-border)" }}>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button type="submit" loading={submitting} disabled={submitting}>
        {submitLabel}
      </Button>
    </div>
  );
}
