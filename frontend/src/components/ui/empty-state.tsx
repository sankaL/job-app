import type { ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

const DefaultIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-ink-25)" }}>
    <rect x="6" y="6" width="36" height="36" rx="8" />
    <path d="M18 24h12M24 18v12" />
  </svg>
);

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="animate-fadeIn flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4">{icon ?? <DefaultIcon />}</div>
      <h3
        className="font-display text-lg font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {title}
      </h3>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--color-ink-50)" }}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
