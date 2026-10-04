import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/VStack";
import { Button } from "@/components/ui/button";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
      <Text
        as="p"
        display="block"
        type="body"
        className="text-[var(--color-text-secondary)]"
      >
        Loading activity…
      </Text>
    );
  if (errorMessage) {
    return (
      <div
        className="border-l p-3"
        style={{
          borderColor: "var(--color-error-muted)",
          background: "var(--color-error-muted)",
        }}
      >
        <Text
          as="p"
          display="block"
          type="label"
          className="text-[var(--color-error)]"
        >
          Activity unavailable
        </Text>
        <Text
          as="p"
          display="block"
          type="supporting"
          className="mt-1 text-[var(--color-text-secondary)]"
        >
          {errorMessage}
        </Text>
      </div>
    );
  }
  if (grouped.length === 0)
    return (
      <Text
        as="p"
        display="block"
        type="body"
        className="text-[var(--color-text-secondary)]"
      >
        No activity yet.
      </Text>
    );

  return <ActivityTimeline grouped={grouped} expandedIds={expandedIds} onToggle={onToggle} />;
}

function ActivityTimeline({ grouped, expandedIds, onToggle }: {
  grouped: ActivityGroup[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    const line = lineRef.current;
    if (!timeline || !line) return;
    const measure = () => {
      const dots = timeline.querySelectorAll<HTMLElement>("[data-activity-dot]");
      const first = dots[0]?.getBoundingClientRect();
      const last = dots[dots.length - 1]?.getBoundingClientRect();
      if (!first || !last) return;
      const top = first.top + first.height / 2;
      line.style.top = `${top - timeline.getBoundingClientRect().top}px`;
      line.style.height = `${last.top + last.height / 2 - top}px`;
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(timeline);
    return () => observer?.disconnect();
  }, [grouped, expandedIds]);

  return (
    <div
      className="relative ml-3 flex flex-col gap-6 pl-6"
      ref={timelineRef}
    >
      <div ref={lineRef} aria-hidden="true" data-testid="activity-timeline-line" className="absolute left-0 w-px bg-[var(--color-border)] pointer-events-none" />
      {grouped.map((group) => (
        <section key={group.label} className="space-y-4">
          <div className="text-xs font-bold text-[var(--color-text-secondary)]">
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
    <VStack
      className="fixed inset-0 z-50"
      data-testid="activity-panel-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Application activity"
        className="absolute inset-x-0 bottom-0 top-[10%] overflow-hidden border-t bg-[var(--color-background-surface)] shadow-[var(--shadow-high)] sm:inset-y-0 sm:left-auto sm:w-[28rem] sm:max-w-[90vw] sm:border-l sm:border-t-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <header
          className="flex items-start justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <Heading level={2} className="text-[var(--color-text-primary)]">
              Activity Log
            </Heading>
            <Text
              as="p"
              display="block"
              type="supporting"
              className="mt-1 text-[var(--color-text-secondary)]"
            >
              Timeline of manual and AI actions for this application.
            </Text>
          </div>
          <Button
            variant="ghost"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center border transition-colors"
            aria-label="Close activity panel"
          >
            <X size={14} aria-hidden="true" />
          </Button>
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
    </VStack>,
    document.body,
  );
}
