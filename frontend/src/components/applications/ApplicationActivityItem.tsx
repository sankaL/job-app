import { Text } from "@astryxdesign/core/Text";
import { Button } from "@/components/ui/button";
import { Clock3, TriangleAlert } from "lucide-react";
import type { ApplicationActivityEvent } from "@/lib/api";
import { formatJudgeInstructions } from "@/lib/judge-helpers";

type ActivityDetails = Record<string, any>;

const COMMON_DETAIL_KEYS = [
  "model_used",
  "failure_stage",
  "section_name",
  "attempt_count",
  "length_diagnostics",
  "validation_errors",
] as const;
const EXTRACTION_DETAIL_KEYS = [
  "job_title",
  "company",
  "job_location_text",
  "compensation_text",
  "job_posting_origin",
] as const;
const JUDGE_DETAIL_KEYS = [
  "display_score",
  "verdict",
  "score_summary",
  "evaluator_notes",
  "regeneration_instructions",
] as const;
const GENERATION_DETAIL_KEYS = [
  "page_length",
  "aggressiveness",
  "additional_instructions",
  "instructions",
  "regeneration_instructions",
] as const;
const DETAIL_KEYS_BY_TYPE: Record<string, readonly string[]> = {
  extraction_succeeded: EXTRACTION_DETAIL_KEYS,
  resume_judge_succeeded: JUDGE_DETAIL_KEYS,
};

function hasValue(details: ActivityDetails, key: string) {
  const value = details[key];
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function isGenerationActivity(type: string) {
  return (
    type === "generation_started" ||
    type === "generation_succeeded" ||
    (type.includes("regeneration_") &&
      (type.endsWith("_started") || type.endsWith("_succeeded")))
  );
}

function getAttemptDurationTotal(item: ApplicationActivityEvent) {
  if (!item.attempts?.length) return null;
  const total = item.attempts.reduce(
    (sum, attempt) =>
      sum + (typeof attempt.elapsed_ms === "number" ? attempt.elapsed_ms : 0),
    0,
  );
  return total > 0 ? total : null;
}

function hasExpandableActivityDetails(item: ApplicationActivityEvent) {
  if (item.attempts?.length) return true;
  const details = item.details as ActivityDetails | null;
  if (!details) return false;
  const typeKeys =
    DETAIL_KEYS_BY_TYPE[item.type] ??
    (isGenerationActivity(item.type) ? GENERATION_DETAIL_KEYS : []);
  return [
    typeof details.duration_ms === "number" && details.duration_ms > 0,
    COMMON_DETAIL_KEYS.some((key) => hasValue(details, key)),
    typeKeys.some((key) => hasValue(details, key)),
  ].some(Boolean);
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function pageLengthLabel(value: unknown) {
  if (value === "1_page") return "1 Page";
  if (value === "2_page") return "2 Pages";
  if (value === "3_page") return "3 Pages";
  return String(value);
}

function formatNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : null;
}

function DetailLine({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: unknown;
  emphasized?: boolean;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <span style={{ color: "var(--color-text-secondary)" }}>{label}: </span>
      <span
        className={emphasized ? "font-medium" : undefined}
        style={{ color: "var(--color-text-primary)" }}
      >
        {String(value)}
      </span>
    </div>
  );
}

function ExtractionDetails({ details }: { details: ActivityDetails }) {
  return (
    <div className="space-y-1">
      <DetailLine label="Job Title" value={details.job_title} emphasized />
      <DetailLine label="Company" value={details.company} emphasized />
      <DetailLine label="Location" value={details.job_location_text} />
      <DetailLine label="Compensation" value={details.compensation_text} />
      <DetailLine
        label="Source"
        value={
          details.job_posting_origin_other_text || details.job_posting_origin
        }
      />
    </div>
  );
}

function InstructionBlock({
  label,
  value,
  judge = false,
}: {
  label: string;
  value: unknown;
  judge?: boolean;
}) {
  if (!value) return null;
  const formatted = judge ? formatJudgeInstructions(value) : String(value);
  return (
    <div
      className="mt-1 border-l-2 pl-2"
      style={{
        borderColor: judge
          ? "var(--color-error-muted)"
          : "var(--color-border-emphasized)",
      }}
    >
      <span
        style={{
          color: judge ? "var(--color-error)" : "var(--color-text-secondary)",
        }}
      >
        {label}:{" "}
      </span>
      <Text
        as="p"
        display="block"
        type="body"
        className="mt-0.5 whitespace-pre-line italic"
        style={{ color: "var(--color-text-secondary)" }}
      >
        &quot;{formatted}&quot;
      </Text>
    </div>
  );
}

function GenerationDetails({ details }: { details: ActivityDetails }) {
  return (
    <div className="space-y-1">
      <DetailLine
        label="Target Length"
        value={
          details.page_length ? pageLengthLabel(details.page_length) : null
        }
      />
      <DetailLine label="Aggressiveness" value={details.aggressiveness} />
      <InstructionBlock
        label="Specific Instructions"
        value={details.additional_instructions || details.instructions}
      />
      <InstructionBlock
        label="Judge Feedback"
        value={details.regeneration_instructions}
        judge
      />
    </div>
  );
}

function LengthDiagnostics({ details }: { details: ActivityDetails }) {
  const diagnostics = details.length_diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return null;
  return (
    <div
      className="mt-1 space-y-0.5 border-l-2 pl-2"
      style={{ borderColor: "var(--color-border-emphasized)" }}
    >
      <div style={{ color: "var(--color-text-secondary)" }}>Length check:</div>
      <DetailLine
        label="Generated"
        value={`${formatNumber(diagnostics.generated_word_count) ?? "Unknown"} words`}
      />
      <DetailLine
        label="Target"
        value={`${formatNumber(diagnostics.target_min) ?? "?"}-${formatNumber(diagnostics.target_max) ?? "?"} words`}
      />
      <DetailLine
        label="Source-aware minimum"
        value={`${formatNumber(diagnostics.minimum_acceptable_words) ?? "Unknown"} words`}
      />
      <DetailLine
        label="Source-limited"
        value={diagnostics.source_limited_length ? "Yes" : "No"}
      />
    </div>
  );
}

function JudgeDetails({ details }: { details: ActivityDetails }) {
  const verdict = details.verdict ? String(details.verdict) : null;
  return (
    <div className="space-y-1">
      <DetailLine
        label="Score"
        value={
          typeof details.display_score === "number"
            ? `${details.display_score}/100`
            : null
        }
        emphasized
      />
      {verdict ? (
        <div>
          <span style={{ color: "var(--color-text-secondary)" }}>
            Verdict:{" "}
          </span>
          <span
            className="font-medium"
            style={{
              color:
                verdict.toLowerCase() === "pass"
                  ? "var(--color-accent)"
                  : "var(--color-error)",
            }}
          >
            {verdict.toUpperCase() === "PASS" ? "Pass" : verdict}
          </span>
        </div>
      ) : null}
      <DetailLine label="Summary" value={details.score_summary} />
      <DetailLine label="Notes" value={details.evaluator_notes} />
      <InstructionBlock
        label="Judge Recommendations"
        value={details.regeneration_instructions}
        judge
      />
      <DetailLine label="Attempts" value={details.attempt_count} />
    </div>
  );
}

function AttemptTimeline({
  attempts,
}: {
  attempts: NonNullable<ApplicationActivityEvent["attempts"]>;
}) {
  if (!attempts.length) return null;
  return (
    <div className="space-y-1">
      <div style={{ color: "var(--color-text-secondary)" }}>
        Attempt timeline:
      </div>
      <ol className="space-y-1 pl-4">
        {attempts.map((attempt, index) => (
          <li
            key={`${attempt.model ?? "unknown"}-${index}`}
            style={{ color: "var(--color-text-primary)" }}
          >
            {index + 1}. {attempt.model ?? "Unknown model"}
            {attempt.outcome ? ` · ${attempt.outcome}` : ""}
            {typeof attempt.elapsed_ms === "number"
              ? ` · ${renderDuration(attempt.elapsed_ms)}`
              : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ValidationErrors({ errors }: { errors: unknown }) {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return (
    <div className="space-y-1">
      <div style={{ color: "var(--color-text-secondary)" }}>
        Validation errors:
      </div>
      <ul
        className="list-disc space-y-1 pl-4"
        style={{ color: "var(--color-text-primary)" }}
      >
        {errors.map((errorLine) => (
          <li key={String(errorLine)}>{String(errorLine)}</li>
        ))}
      </ul>
    </div>
  );
}

function ActivityTypeDetails({
  type,
  details,
}: {
  type: string;
  details: ActivityDetails;
}) {
  if (type === "extraction_succeeded")
    return <ExtractionDetails details={details} />;
  if (type === "resume_judge_succeeded")
    return <JudgeDetails details={details} />;
  if (isGenerationActivity(type))
    return <GenerationDetails details={details} />;
  return null;
}

function NonJudgeAttemptCount({
  type,
  value,
}: {
  type: string;
  value: unknown;
}) {
  if (type === "resume_judge_succeeded") return null;
  return <DetailLine label="Attempts" value={value} />;
}

function ActivityDetailsView({ item }: { item: ApplicationActivityEvent }) {
  const details = (item.details ?? {}) as ActivityDetails;
  const duration =
    typeof details.duration_ms === "number"
      ? details.duration_ms
      : getAttemptDurationTotal(item);
  return (
    <>
      <ActivityTypeDetails type={item.type} details={details} />
      <LengthDiagnostics details={details} />
      <DetailLine label="Model" value={details.model_used} />
      <DetailLine
        label="Duration"
        value={
          typeof duration === "number" && duration > 0
            ? renderDuration(duration)
            : null
        }
      />
      <DetailLine label="Failure stage" value={details.failure_stage} />
      <DetailLine label="Section" value={details.section_name} />
      <NonJudgeAttemptCount type={item.type} value={details.attempt_count} />
      <ValidationErrors errors={details.validation_errors} />
      <AttemptTimeline attempts={item.attempts ?? []} />
    </>
  );
}

function ActivityRow({
  item,
  expanded,
  expandable,
}: {
  item: ApplicationActivityEvent;
  expanded: boolean;
  expandable: boolean;
}) {
  const failure = item.status === "failure";
  const label = failure
    ? "Failed"
    : item.status === "success"
      ? "Completed"
      : "Info";
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Text
            as="p"
            display="block"
            type="label"
            style={{ color: "var(--color-text-primary)" }}
          >
            {item.title}
          </Text>
          <Text
            as="p"
            display="block"
            type="supporting"
            className="mt-0.5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {item.summary}
          </Text>
        </div>
        <span
          className="shrink-0 text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {formatTime(item.created_at)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold"
          style={{
            background: failure
              ? "var(--color-error-muted)"
              : "var(--color-background-muted)",
            color: failure
              ? "var(--color-error)"
              : "var(--color-text-secondary)",
          }}
        >
          {failure ? (
            <TriangleAlert size={11} aria-hidden="true" />
          ) : (
            <Clock3 size={11} aria-hidden="true" />
          )}
          {label}
        </span>
        {expandable ? (
          <span style={{ color: "var(--color-accent)" }}>
            {expanded ? "Hide details" : "Details"}
          </span>
        ) : null}
      </div>
    </>
  );
}

export function ApplicationActivityItem({
  item,
  expanded,
  onToggle,
}: {
  item: ApplicationActivityEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const expandable = hasExpandableActivityDetails(item);
  const failure = item.status === "failure";
  const dotColor = failure
    ? "var(--color-error)"
    : item.status === "success"
      ? "var(--color-accent)"
      : "var(--color-border-emphasized)";
  const row = (
    <ActivityRow item={item} expanded={expanded} expandable={expandable} />
  );

  return (
    <article className="group/item relative">
      <div
        className="absolute left-[-29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 bg-[var(--color-background-surface)] transition-transform group-hover/item:scale-110"
        style={{ borderColor: dotColor }}
      />
      {expandable ? (
        <Button
          variant="ghost"
          type="button"
          onClick={onToggle}
          className="-m-1.5 w-full p-1.5 text-left transition-colors"
          aria-expanded={expanded}
          aria-controls={`activity-details-${item.id}`}
        >
          {row}
        </Button>
      ) : (
        <div className="-m-1.5 rounded-md p-1.5">{row}</div>
      )}
      {failure && item.failure_message ? (
        <Text
          as="p"
          display="block"
          type="supporting"
          className="mt-2 rounded-md border px-2 py-1.5"
          style={{
            borderColor: "var(--color-error-muted)",
            color: "var(--color-error)",
          }}
        >
          {item.failure_message}
        </Text>
      ) : null}
      {expandable && expanded ? (
        <div
          id={`activity-details-${item.id}`}
          className="mt-2 space-y-2 border-l-2 pl-3 text-xs"
          style={{ borderColor: "var(--color-border)" }}
        >
          <ActivityDetailsView item={item} />
        </div>
      ) : null}
    </article>
  );
}
