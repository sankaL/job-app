import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, badge, actions }: PageHeaderProps) {
  return (
    <div className="page-header-mobile animate-fadeIn flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-start sm:justify-between" style={{ maxWidth: "100%" }}>
      <div className="min-w-0 flex-1" style={{ maxWidth: "100%" }}>
        <div className="flex items-center gap-2 sm:gap-3 overflow-hidden">
          <h1
            className="font-display text-xl font-semibold tracking-tight sm:text-2xl truncate"
            style={{ color: "var(--color-ink)", maxWidth: "100%" }}
            title={title}
          >
            {title}
          </h1>
          {badge && <span className="flex-shrink-0">{badge}</span>}
        </div>
        {subtitle && (
          <p className="page-header-subtitle mt-1 text-sm" style={{ color: "var(--color-ink-50)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-shrink-0">{actions}</div>}
    </div>
  );
}
