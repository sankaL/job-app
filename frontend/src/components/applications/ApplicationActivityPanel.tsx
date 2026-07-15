import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ApplicationActivityItem } from "@/components/applications/ApplicationActivityItem";
import type { ApplicationActivityEvent } from "@/lib/api";
import { useApplicationActivityQuery } from "@/lib/queries";

type ApplicationActivityPanelProps = {
  applicationId: string | null;
  open: boolean;
  onClose: () => void;
};

type ActivityGroup = {
  label: string;
  items: ApplicationActivityEvent[];
};

function formatDayLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recent activity";
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function groupActivity(items: ApplicationActivityEvent[]): ActivityGroup[] {
  const groups = new Map<string, ApplicationActivityEvent[]>();
  for (const item of items) {
    const key = formatDayLabel(item.created_at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups, ([label, groupItems]) => ({
    label,
    items: groupItems,
  }));
}

function ActivityPanelBody({
  isLoading,
  errorMessage,
  grouped,
  expandedIds,
  onToggle,
}: {
  isLoading: boolean;
  errorMessage: string | null;
  grouped: ActivityGroup[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (isLoading)
    return (
      <p className="text-sm text-[var(--color-ink-50)]">Loading activity…</p>
    );
  if (errorMessage) {
    return (
      <div
        className="rounded-lg border p-3"
        style={{
          borderColor: "var(--color-ember-10)",
          background: "var(--color-ember-05)",
        }}
      >
        <p className="text-sm font-semibold text-[var(--color-ember)]">
          Activity unavailable
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-65)]">
          {errorMessage}
        </p>
      </div>
    );
  }
  if (grouped.length === 0)
    return (
      <p className="text-sm text-[var(--color-ink-50)]">No activity yet.</p>
    );

  return (
    <div
      className="relative ml-3 space-y-6 border-l pl-6"
      style={{ borderColor: "var(--color-border)" }}
    >
      {grouped.map((group) => (
        <section key={group.label} className="space-y-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-40)]">
            {group.label}
          </div>
          <div className="space-y-4">
            {group.items.map((item) => (
              <ApplicationActivityItem
                key={item.id}
                item={item}
                expanded={expandedIds.has(item.id)}
                onToggle={() => onToggle(item.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function getDialogFocusBoundary() {
  const drawer = document.querySelector('[role="dialog"]');
  if (!drawer) return null;
  const focusables = drawer.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return null;
  return { first: focusables[0], last: focusables[focusables.length - 1] };
}

function keepFocusInDialog(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const boundary = getDialogFocusBoundary();
  if (!boundary) return;
  const edge = event.shiftKey ? boundary.first : boundary.last;
  if (document.activeElement !== edge) return;
  (event.shiftKey ? boundary.last : boundary.first).focus();
  event.preventDefault();
}

export function ApplicationActivityPanel({
  applicationId,
  open,
  onClose,
}: ApplicationActivityPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const {
    data: activity = [],
    isLoading,
    error,
  } = useApplicationActivityQuery(
    applicationId ?? undefined,
    open && Boolean(applicationId),
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setExpandedIds(new Set());
    const focusTimer = window.setTimeout(
      () => closeButtonRef.current?.focus(),
      0,
    );
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (open) return;
    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else keepFocusInDialog(event);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const grouped = useMemo(() => groupActivity(activity), [activity]);
  const errorMessage = error instanceof Error ? error.message : null;

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/35"
        aria-label="Close activity panel"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Application activity"
        className="absolute inset-x-0 bottom-0 top-[10%] overflow-hidden border-t bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:w-[28rem] sm:max-w-[90vw] sm:border-l sm:border-t-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <header
          className="flex items-start justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">
              Activity Log
            </h2>
            <p className="mt-1 text-xs text-[var(--color-ink-50)]">
              Timeline of manual and AI actions for this application.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-[var(--color-ink-50)] transition-colors"
            style={{ borderColor: "var(--color-border)" }}
            aria-label="Close activity panel"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="h-[calc(100%-65px)] overflow-y-auto px-4 py-3">
          <ActivityPanelBody
            isLoading={isLoading}
            errorMessage={errorMessage}
            grouped={grouped}
            expandedIds={expandedIds}
            onToggle={toggleExpanded}
          />
        </div>
      </aside>
    </div>,
    document.body,
  );
}
