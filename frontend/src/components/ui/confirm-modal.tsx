import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

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
  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmBg = variant === "danger" ? "var(--color-ember)" : "var(--color-ink)";
  const confirmHoverBg = variant === "danger" ? "#b8431a" : "var(--color-spruce)";

  const modal = (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(16, 24, 40, 0.5)",
          backdropFilter: "blur(6px)",
          animation: "fadeIn 200ms var(--ease-out) both",
        }}
      />

      {/* Dialog */}
      <div
        className="animate-scaleIn"
        style={{
          position: "relative",
          zIndex: 1,
          background: "var(--color-white)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-panel)",
          padding: "28px 28px 24px",
          maxWidth: "420px",
          width: "calc(100% - 32px)",
        }}
      >
        <h3
          style={{
            fontSize: "17px",
            fontWeight: 600,
            color: "var(--color-ink)",
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          {title}
        </h3>
        {message && (
          <p
            style={{
              marginTop: "10px",
              fontSize: "14px",
              color: "var(--color-ink-65)",
              lineHeight: 1.55,
              margin: "10px 0 0",
            }}
          >
            {message}
          </p>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "24px",
          }}
        >
          {/* Cancel — ghost/muted */}
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "transparent",
              color: "var(--color-ink-50)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.5 : 1,
              transition: "color 150ms, background 150ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-ink-05)";
              e.currentTarget.style.color = "var(--color-ink)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--color-ink-50)";
            }}
          >
            {cancelLabel}
          </button>
          {/* Confirm — solid */}
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "8px 20px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: confirmBg,
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              transition: "background 150ms, transform 100ms",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = confirmHoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = confirmBg;
            }}
          >
            {loading && (
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="8" strokeLinecap="round" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  // Portal to document.body so the modal isn't clipped by any parent overflow/transform
  return createPortal(modal, document.body);
}
