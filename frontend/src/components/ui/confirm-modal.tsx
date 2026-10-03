import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function useConfirmModalLifecycle(
  open: boolean,
  loading: boolean | undefined,
  onCancel: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, loading, onCancel]);
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant,
  loading,
  onConfirm,
  onCancel,
}: Omit<ConfirmModalProps, "open"> &
  Required<
    Pick<ConfirmModalProps, "confirmLabel" | "cancelLabel" | "variant">
  >) {
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close confirmation"
        onClick={loading ? undefined : onCancel}
        disabled={loading}
        className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-[6px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-scaleIn relative z-[1] w-[calc(100%-32px)] max-w-[420px] rounded-[var(--radius-container)] bg-[var(--color-background-surface)] px-7 pb-6 pt-7 shadow-[var(--shadow-high)]"
      >
        <h3 className="m-0 text-[17px] font-semibold leading-[1.3] text-[var(--color-text-primary)]">
          {title}
        </h3>
        {message ? (
          <div className="mt-2.5 text-sm leading-[1.55] text-[var(--color-text-secondary)]">
            {message}
          </div>
        ) : null}
        <div className="mt-6 flex justify-end gap-2.5">
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === "danger" ? "danger" : "primary"}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  loading,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useConfirmModalLifecycle(open, loading, onCancel);
  if (!open) return null;
  return createPortal(
    <ConfirmDialog
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      variant={variant}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
    document.body,
  );
}
