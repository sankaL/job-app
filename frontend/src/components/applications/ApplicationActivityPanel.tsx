import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3, TriangleAlert, X } from "lucide-react";
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
  if (Number.isNaN(parsed.getTime())) {
    return "Recent activity";
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupActivity(items: ApplicationActivityEvent[]): ActivityGroup[] {
  const groups = new Map<string, ApplicationActivityEvent[]>();
  for (const item of items) {
    const key = formatDayLabel(item.created_at);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries()).map(([label, groupItems]) => ({
    label,
    items: groupItems,
  }));
}

function renderDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function hasExpandableDetails(item: ApplicationActivityEvent) {
  const details = item.details as any;
  if (!details && !item.attempts?.length) return false;

  const totalDurationMs =
    typeof details?.duration_ms === "number"
      ? details.duration_ms
      : getAttemptDurationTotal(item);

  if (item.attempts && item.attempts.length > 0) return true;
  if (details) {
    if (typeof details.model_used === "string") return true;
    if (typeof totalDurationMs === "number" && totalDurationMs > 0) return true;
    if (typeof details.failure_stage === "string") return true;
    if (typeof details.section_name === "string") return true;
    if (typeof details.attempt_count === "number") return true;
    if (Array.isArray(details.validation_errors) && details.validation_errors.length > 0) return true;

    // Custom events
    if (item.type === "extraction_succeeded") {
      return Boolean(details.job_title || details.company || details.job_location_text || details.compensation_text || details.job_posting_origin);
    }
    if (item.type === "resume_judge_succeeded") {
      return Boolean(typeof details.display_score === "number" || details.verdict || details.score_summary || details.evaluator_notes || typeof details.attempt_count === "number");
    }
    if (item.type === "generation_started" || (item.type?.includes("regeneration_") && item.type?.endsWith("_started"))) {
      return Boolean(details.page_length || details.aggressiveness);
    }
  }
  return false;
}

function getAttemptDurationTotal(item: ApplicationActivityEvent) {
  if (!item.attempts?.length) return null;
  const sum = item.attempts.reduce((acc, attempt) => {
    if (typeof attempt.elapsed_ms === "number") {
      return acc + attempt.elapsed_ms;
    }
    return acc;
  }, 0);
  return sum > 0 ? sum : null;
}

function isFailure(item: ApplicationActivityEvent) {
  return item.status === "failure";
}

function statusLabel(item: ApplicationActivityEvent) {
  if (item.status === "failure") return "Failed";
  if (item.status === "success") return "Completed";
  return "Info";
}

function pageLengthLabel(value: unknown) {
  if (value === "1_page") return "1 Page";
  if (value === "2_page") return "2 Pages";
  if (value === "3_page") return "3 Pages";
  return String(value);
}

export function ApplicationActivityPanel({ applicationId, open, onClose }: ApplicationActivityPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const {
    data: activity = [],
    isLoading,
    error,
  } = useApplicationActivityQuery(applicationId ?? undefined, open && Boolean(applicationId));

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setExpandedIds(new Set());
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    const previous = restoreFocusRef.current;
    if (previous) {
      previous.focus();
    }
    restoreFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const drawer = document.querySelector('[role="dialog"]');
        if (!drawer) return;
        const focusables = drawer.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            event.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            event.preventDefault();
          }
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const grouped = useMemo(() => groupActivity(activity), [activity]);
  const hasActivity = grouped.length > 0;
  const errorMessage = error instanceof Error ? error.message : null;

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Activity Log
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--color-ink-50)" }}>
              Timeline of manual and AI actions for this application.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-50)" }}
            aria-label="Close activity panel"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="h-[calc(100%-65px)] overflow-y-auto px-4 py-3">
          {isLoading ? (
            <p className="text-sm" style={{ color: "var(--color-ink-50)" }}>
              Loading activity…
            </p>
          ) : errorMessage ? (
            <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-ember-10)", background: "var(--color-ember-05)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
                Activity unavailable
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--color-ink-65)" }}>
                {errorMessage}
              </p>
            </div>
          ) : !hasActivity ? (
            <p className="text-sm" style={{ color: "var(--color-ink-50)" }}>
              No activity yet.
            </p>
          ) : (
            <div className="relative ml-3 pl-6 border-l space-y-6" style={{ borderColor: "var(--color-border)" }}>
              {grouped.map((group) => (
                <section key={group.label} className="space-y-4">
                  <div className="relative">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-40)" }}>
                      {group.label}
                    </div>
                  </div>
                  <div className="space-y-4">
                    {group.items.map((item) => {
                      const expanded = expandedIds.has(item.id);
                      const expandable = hasExpandableDetails(item);
                      const failure = isFailure(item);
                      const details = item.details as any;
                      const totalDurationMs =
                        typeof details?.duration_ms === "number"
                          ? details.duration_ms
                          : getAttemptDurationTotal(item);

                      const dotColor = failure
                        ? "var(--color-ember)"
                        : item.status === "success"
                        ? "var(--color-spruce)"
                        : "var(--color-ink-20)";
                      const rowContent = (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                                {item.title}
                              </p>
                              <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-65)" }}>
                                {item.summary}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] font-medium" style={{ color: "var(--color-ink-40)" }}>
                              {formatTime(item.created_at)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase tracking-[0.12em]"
                              style={{
                                background: failure ? "var(--color-ember-10)" : "var(--color-ink-05)",
                                color: failure ? "var(--color-ember)" : "var(--color-ink-50)",
                              }}
                            >
                              {failure ? <TriangleAlert size={11} aria-hidden="true" /> : <Clock3 size={11} aria-hidden="true" />}
                              {statusLabel(item)}
                            </span>
                            {expandable && (
                              <span style={{ color: "var(--color-spruce)" }}>
                                {expanded ? "Hide details" : "Details"}
                              </span>
                            )}
                          </div>
                        </>
                      );

                      return (
                        <article key={item.id} className="relative group/item">
                          <div
                            className="absolute left-[-29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 bg-white transition-transform group-hover/item:scale-110"
                            style={{ borderColor: dotColor }}
                          />

                          {expandable ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(item.id)}
                              className="w-full text-left transition-colors rounded-md p-1.5 -m-1.5 hover:bg-[var(--color-ink-05)]"
                              aria-expanded={expanded}
                              aria-controls={`activity-details-${item.id}`}
                            >
                              {rowContent}
                            </button>
                          ) : (
                            <div className="rounded-md p-1.5 -m-1.5">
                              {rowContent}
                            </div>
                          )}

                          {failure && item.failure_message ? (
                            <p className="mt-2 rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: "var(--color-ember-10)", color: "var(--color-ember)" }}>
                              {item.failure_message}
                            </p>
                          ) : null}

                          {expandable && expanded && (
                            <div
                              id={`activity-details-${item.id}`}
                              className="mt-2 pl-3 space-y-2 border-l-2 text-xs"
                              style={{ borderColor: "var(--color-border)" }}
                            >
                              {item.type === "extraction_succeeded" && details && (
                                <div className="space-y-1">
                                  {details.job_title && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Job Title: </span>
                                      <span className="font-medium" style={{ color: "var(--color-ink)" }}>{details.job_title}</span>
                                    </div>
                                  )}
                                  {details.company && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Company: </span>
                                      <span className="font-medium" style={{ color: "var(--color-ink)" }}>{details.company}</span>
                                    </div>
                                  )}
                                  {details.job_location_text && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Location: </span>
                                      <span style={{ color: "var(--color-ink)" }}>{details.job_location_text}</span>
                                    </div>
                                  )}
                                  {details.compensation_text && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Compensation: </span>
                                      <span style={{ color: "var(--color-ink)" }}>{details.compensation_text}</span>
                                    </div>
                                  )}
                                  {(details.job_posting_origin || details.job_posting_origin_other_text) && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Source: </span>
                                      <span style={{ color: "var(--color-ink)" }}>
                                        {details.job_posting_origin_other_text || details.job_posting_origin}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {(item.type === "generation_started" || (item.type?.includes("regeneration_") && item.type?.endsWith("_started"))) && details && (
                                <div className="space-y-1">
                                  {details.page_length && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Target Length: </span>
                                      <span style={{ color: "var(--color-ink)" }}>
                                        {pageLengthLabel(details.page_length)}
                                      </span>
                                    </div>
                                  )}
                                  {details.aggressiveness && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Aggressiveness: </span>
                                      <span className="capitalize" style={{ color: "var(--color-ink)" }}>
                                        {details.aggressiveness}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {item.type === "resume_judge_succeeded" && details && (
                                <div className="space-y-1">
                                  {typeof details.display_score === "number" && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Score: </span>
                                      <span className="font-semibold" style={{ color: "var(--color-ink)" }}>
                                        {details.display_score}/100
                                      </span>
                                    </div>
                                  )}
                                  {details.verdict && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Verdict: </span>
                                      <span
                                        className="font-medium"
                                        style={{
                                          color: details.verdict.toLowerCase() === "pass" ? "var(--color-spruce)" : "var(--color-ember)"
                                        }}
                                      >
                                        {details.verdict.toUpperCase() === "PASS" ? "Pass" : details.verdict}
                                      </span>
                                    </div>
                                  )}
                                  {details.score_summary && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Summary: </span>
                                      <span style={{ color: "var(--color-ink)" }}>{details.score_summary}</span>
                                    </div>
                                  )}
                                  {details.evaluator_notes && (
                                    <div className="mt-1">
                                      <span style={{ color: "var(--color-ink-40)" }}>Notes: </span>
                                      <span className="italic" style={{ color: "var(--color-ink-65)" }}>"{details.evaluator_notes}"</span>
                                    </div>
                                  )}
                                  {typeof details.attempt_count === "number" && (
                                    <div>
                                      <span style={{ color: "var(--color-ink-40)" }}>Attempts: </span>
                                      <span style={{ color: "var(--color-ink)" }}>{details.attempt_count}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {typeof details?.model_used === "string" ? (
                                <div>
                                  <span style={{ color: "var(--color-ink-40)" }}>Model: </span>
                                  <span style={{ color: "var(--color-ink)" }}>{details.model_used}</span>
                                </div>
                              ) : null}
                              {typeof totalDurationMs === "number" && totalDurationMs > 0 ? (
                                <div>
                                  <span style={{ color: "var(--color-ink-40)" }}>Duration: </span>
                                  <span style={{ color: "var(--color-ink)" }}>{renderDuration(totalDurationMs)}</span>
                                </div>
                              ) : null}
                              {typeof details?.failure_stage === "string" ? (
                                <div>
                                  <span style={{ color: "var(--color-ink-40)" }}>Failure stage: </span>
                                  <span style={{ color: "var(--color-ink)" }}>{details.failure_stage}</span>
                                </div>
                              ) : null}
                              {typeof details?.section_name === "string" ? (
                                <div>
                                  <span style={{ color: "var(--color-ink-40)" }}>Section: </span>
                                  <span style={{ color: "var(--color-ink)" }}>{details.section_name}</span>
                                </div>
                              ) : null}
                              {item.type !== "resume_judge_succeeded" && typeof details?.attempt_count === "number" ? (
                                <div>
                                  <span style={{ color: "var(--color-ink-40)" }}>Attempts: </span>
                                  <span style={{ color: "var(--color-ink)" }}>{details.attempt_count}</span>
                                </div>
                              ) : null}
                              {Array.isArray(details?.validation_errors) && details.validation_errors.length > 0 ? (
                                <div className="space-y-1">
                                  <div style={{ color: "var(--color-ink-40)" }}>Validation errors:</div>
                                  <ul className="list-disc space-y-1 pl-4" style={{ color: "var(--color-ink)" }}>
                                    {details.validation_errors.map((errorLine: any) => (
                                      <li key={String(errorLine)}>{String(errorLine)}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {item.attempts?.length ? (
                                <div className="space-y-1">
                                  <div style={{ color: "var(--color-ink-40)" }}>Attempt timeline:</div>
                                  <ol className="space-y-1 pl-4">
                                    {item.attempts.map((attempt, index) => (
                                      <li key={`${attempt.model ?? "unknown"}-${index}`} style={{ color: "var(--color-ink)" }}>
                                        <span>{index + 1}. </span>
                                        <span>{attempt.model ?? "Unknown model"}</span>
                                        {attempt.outcome ? <span>{` · ${attempt.outcome}`}</span> : null}
                                        {typeof attempt.elapsed_ms === "number" ? <span>{` · ${renderDuration(attempt.elapsed_ms)}`}</span> : null}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
