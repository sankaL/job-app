import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, badge, actions }: PageHeaderProps) {
  return (
    <div className="animate-fadeIn flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="font-display text-2xl font-semibold tracking-tight"
            style={{ color: "var(--color-ink)" }}
          >
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-50)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:flex-shrink-0 xl:justify-end">{actions}</div>}
    </div>
  );
}
