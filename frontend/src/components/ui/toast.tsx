import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";

/* ── Types ── */
type ToastVariant = "success" | "error" | "info";

type Toast = {
  id: string;
  message: ReactNode;
  variant: ToastVariant;
  dismissing?: boolean;
};

type ToastContextValue = {
  toast: (message: ReactNode, variant?: ToastVariant) => void;
};

/* ── Context ── */
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside <ToastProvider>");
  return ctx;
}

/* ── Constants ── */
const AUTO_DISMISS_MS = 4000;
const DISMISS_ANIMATION_MS = 300;

let nextId = 0;

/* ── Icons ── */
const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

const ErrorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5M8 10.5v.5" />
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7v4M8 5v.5" />
  </svg>
);

const variantStyles: Record<ToastVariant, { bg: string; border: string; color: string; icon: ReactNode }> = {
  success: {
    bg: "var(--color-spruce-05)",
    border: "var(--color-spruce)",
    color: "var(--color-spruce)",
    icon: <CheckIcon />,
  },
  error: {
    bg: "var(--color-ember-05)",
    border: "var(--color-ember)",
    color: "var(--color-ember)",
    icon: <ErrorIcon />,
  },
  info: {
    bg: "var(--color-ink-05)",
    border: "var(--color-ink-25)",
    color: "var(--color-ink)",
    icon: <InfoIcon />,
  },
};

/* ── Provider ── */
export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DISMISS_ANIMATION_MS);
  }, []);

  const toast = useCallback(
    (message: ReactNode, variant: ToastVariant = "success") => {
      const id = `toast-${++nextId}`;
      setToasts((prev) => [...prev, { id, message, variant }]);

      const timer = window.setTimeout(() => {
        dismiss(id);
        timersRef.current.delete(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast Container */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            pointerEvents: "none",
            maxWidth: "420px",
            width: "100%",
          }}
        >
          {toasts.map((t) => {
            const style = variantStyles[t.variant];
            return (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "12px 16px",
                  borderRadius: "var(--radius-lg)",
                  border: `1px solid ${style.border}`,
                  background: style.bg,
                  backdropFilter: "blur(12px)",
                  boxShadow: "var(--shadow-md)",
                  color: style.color,
                  pointerEvents: "auto",
                  animation: t.dismissing
                    ? `toastSlideOut ${DISMISS_ANIMATION_MS}ms var(--ease-out) forwards`
                    : `toastSlideIn 350ms var(--ease-spring) both`,
                }}
              >
                <span style={{ flexShrink: 0 }}>{style.icon}</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: "var(--color-ink)",
                  }}
                >
                  {t.message}
                </span>
                <button
                  onClick={() => {
                    const timer = timersRef.current.get(t.id);
                    if (timer) {
                      window.clearTimeout(timer);
                      timersRef.current.delete(t.id);
                    }
                    dismiss(t.id);
                  }}
                  style={{
                    flexShrink: 0,
                    background: "none",
                    border: "none",
                    color: "var(--color-ink-40)",
                    cursor: "pointer",
                    padding: "2px",
                    lineHeight: 1,
                    fontSize: "16px",
                  }}
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}
