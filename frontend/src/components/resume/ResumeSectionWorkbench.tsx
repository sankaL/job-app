import { ActionButtons } from "@/components/ui/button-group";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { Textarea } from "@/components/ui/textarea";
import {
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import "./resume-workbench.css";
import { ResumeSectionPreview } from "./ResumeSectionPreview";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  RefreshCw,
  Trash2,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  ProfileData,
  ResumeDocument,
  ResumeSection,
  ResumeSectionEntry,
  ResumeSectionKind,
} from "@/lib/api";
import {
  createResumeEntry,
  createResumeSection,
  hasSectionContent,
  newResumeId,
  renderSectionContent,
  sourceSectionReviewError,
  SECTION_LABELS,
} from "@/lib/resume-document";

export function ResumeContactSection({
  profile,
  suggestions,
}: {
  profile: ProfileData | null;
  suggestions?: Partial<
    Record<"name" | "email" | "phone" | "address" | "linkedin", string>
  >;
}) {
  const contact = [
    profile?.email,
    profile?.phone,
    profile?.address,
    profile?.linkedin_url,
  ].filter(Boolean);
  return (
    <div>
      <div className="resume-section-header">
        <div className="min-w-0 flex-1">
          <Heading level={3} className="resume-section-heading break-words">
            Contact information
          </Heading>
          <Text
            as="p"
            display="block"
            type="supporting"
            className="mt-2"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Copied from your profile. Never sent for tailoring.
          </Text>
        </div>
        <div className="resume-section-controls">
          <Link to="/app/profile" className="resume-profile-edit">
            <Pencil size={14} aria-hidden="true" /> Edit profile
          </Link>
        </div>
      </div>
      <div className="resume-preview-copy">
        <Text as="p" display="block" type="label">
          {profile?.name ||
            [profile?.first_name, profile?.last_name]
              .filter(Boolean)
              .join(" ") ||
            "Add your name in your profile"}
        </Text>
        <Text as="p" display="block" type="body">
          {contact.join(" · ") || "Add your contact details in your profile."}
        </Text>
        {suggestions && Object.values(suggestions).some(Boolean) && (
          <div
            className="resume-preview-entry mt-5 border-t pt-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Text as="p" display="block" type="label">
              Contact found in your upload
            </Text>
            <dl>
              {Object.entries(suggestions)
                .filter(([, value]) => Boolean(value))
                .map(([key, value]) => (
                  <div key={key} className="flex flex-wrap gap-x-2">
                    <dt className="capitalize">{key}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                ))}
            </dl>
            <Text
              as="p"
              display="block"
              type="supporting"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Review these details in your profile before using them.
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  title: "Role title",
  company: "Employer",
  institution: "Institution",
  degree: "Degree",
  qualification: "Degree or qualification",
  details: "Details",
  url: "Link",
  location: "Location",
  date_range: "Dates",
  name: "Name",
  issuer: "Issuer",
  date: "Date",
  description: "Description",
};
const FIELD_ORDER: Partial<Record<ResumeSectionKind, string[]>> = {
  professional_experience: ["title", "company", "location", "date_range"],
  education: ["qualification", "institution", "location", "date_range"],
  projects: ["name", "details", "url"],
  certifications: ["name", "issuer", "date"],
};

function GrowingTextarea({
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    function resize() {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight + 2}px`;
    }
    resize();
    // Reflow long prose when the workbench changes width, not only when it is edited.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [value]);
  return (
    <Textarea {...props} value={value} ref={ref} className="resume-prose" />
  );
}

function EntryEditor({
  entry,
  index,
  kind,
  disabled,
  onChange,
  onRemove,
  onRegenerate,
  regenerationDisabled = false,
  regenerationReason,
}: {
  entry: ResumeSectionEntry;
  index: number;
  kind: ResumeSectionKind;
  disabled: boolean;
  onChange: (entry: ResumeSectionEntry) => void;
  onRemove: () => void;
  onRegenerate?: () => void;
  regenerationDisabled?: boolean;
  regenerationReason?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const preferredFields = FIELD_ORDER[kind] ?? [];
  const fieldKeys = [
    ...preferredFields,
    ...Object.keys(entry.fields)
      .filter((key) => !preferredFields.includes(key))
      .sort(),
  ];
  return (
    <div className="resume-entry" data-entry-id={entry.id}>
      <div className="resume-entry-header">
        <Button
          variant="ghost"
          type="button"
          className="resume-entry-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${kind === "professional_experience" ? "role" : "entry"} ${index + 1}`}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="resume-entry-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0">
            <span className="block break-words font-semibold">
              {entry.fields.company ||
                entry.fields.institution ||
                entry.fields.name ||
                (kind === "professional_experience"
                  ? `Role ${index + 1}`
                  : `Entry ${index + 1}`)}
            </span>
            <span
              className="block break-words text-xs font-normal"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {[
                entry.fields.title || entry.fields.qualification,
                entry.fields.date_range,
              ]
                .filter(Boolean)
                .join(" · ") || "Add the facts below"}
            </span>
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        </Button>
        <div className="resume-entry-actions">
          <ActionButtons label="Resume entry actions" size="sm" primaryIndex={0}>
            {onRegenerate && (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={disabled || regenerationDisabled}
                title={regenerationReason ?? undefined}
                onClick={onRegenerate}
              >
                <RefreshCw size={13} /> Regenerate role
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={disabled}
              aria-label={`Remove entry ${index + 1}`}
              onClick={onRemove}
            >
              <Trash2 size={13} />
            </Button>

          </ActionButtons>
</div>
      </div>
      <div id={contentId} hidden={!expanded}>
        {onRegenerate && regenerationReason && (
          <Text
            as="p"
            display="block"
            type="supporting"
            className="mb-3"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {regenerationReason}
          </Text>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {fieldKeys.map((key) => (
            <label key={key} className="min-w-0 space-y-1 text-xs">
              <span style={{ color: "var(--color-text-secondary)" }}>
                {FIELD_LABELS[key] ?? key.replaceAll("_", " ")}
              </span>
              <Input
                disabled={disabled}
                value={entry.fields[key] ?? ""}
                onChange={(event) =>
                  onChange({
                    ...entry,
                    fields: { ...entry.fields, [key]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {entry.bullets.map((bullet, bulletIndex) => (
            <div key={bullet.id} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-2 text-xs"
                style={{ color: "var(--color-text-secondary)" }}
              >
                •
              </span>
              <div className="min-w-0 flex-1">
                <GrowingTextarea
                  disabled={disabled}
                  aria-label={`Entry ${index + 1} bullet ${bulletIndex + 1}`}
                  rows={2}
                  value={bullet.text}
                  onChange={(event) =>
                    onChange({
                      ...entry,
                      bullets: entry.bullets.map((item) =>
                        item.id === bullet.id
                          ? { ...item, text: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
                {bullet.source_ids.length > 1 && (
                  <Text
                    as="p"
                    display="block"
                    type="supporting"
                    className="mt-1"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    Based on {bullet.source_ids.length} source bullets
                  </Text>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={disabled}
                aria-label={`Remove bullet ${bulletIndex + 1} from entry ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...entry,
                    bullets: entry.bullets.filter(
                      (item) => item.id !== bullet.id,
                    ),
                  })
                }
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...entry,
                bullets: [
                  ...entry.bullets,
                  { id: newResumeId("bullet"), text: "", source_ids: [] },
                ],
              })
            }
          >
            <Plus size={13} /> Add bullet
          </Button>
        </div>
      </div>
    </div>
  );
}

export type SectionProcessing = { sectionId?: string; entryId?: string; content: ReactNode };

export function ResumeSectionWorkbench({
  document,
  onChange,
  disabled = false,
  source = false,
  onRegenerate,
  canRegenerate,
  regenerationReason,
  contactPanel,
  referencePanel,
  processing,
}: {
  contactPanel?: ReactNode;
  referencePanel?: ReactNode;
  processing?: SectionProcessing;
  document: ResumeDocument;
  onChange: (document: ResumeDocument) => void;
  disabled?: boolean;
  source?: boolean;
  onRegenerate?: (section: ResumeSection, entryId?: string) => void;
  canRegenerate?: (section: ResumeSection, entryId?: string) => boolean;
  regenerationReason?: (
    section: ResumeSection,
    entryId?: string,
  ) => string | null;
}) {
  const workbenchId = useId();
  const [verticalTabs, setVerticalTabs] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setVerticalTabs(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    contactPanel ? "contact" : null,
  );
  useEffect(() => {
    if (processing?.sectionId) {
      setSelectedId(`section:${processing.sectionId}`);
      setEditingId(null);
    }
  }, [processing?.sectionId]);
  const [newKind, setNewKind] = useState<ResumeSectionKind>(
    "professional_experience",
  );
  function updateSection(
    id: string,
    update: Partial<ResumeSection>,
    reviewChanged = true,
  ) {
    onChange({
      ...document,
      sections: document.sections.map((section) =>
        section.id === id
          ? {
              ...section,
              ...update,
              ...(source && reviewChanged
                ? { review_state: "needs_review" as const }
                : {}),
            }
          : section,
      ),
    });
  }
  function moveSection(index: number, delta: number) {
    const sections = [...document.sections];
    [sections[index], sections[index + delta]] = [
      sections[index + delta],
      sections[index],
    ];
    onChange({ ...document, sections });
  }
  function addEntry(section: ResumeSection) {
    setEditingId(section.id);
    const entry = createResumeEntry(section.kind);
    const preserveText =
      section.entries.length === 0 && Boolean(section.content_md.trim());
    if (preserveText) {
      entry.bullets = (section.content_md.match(/[\s\S]{1,10000}/gu) ?? []).map(
        (text) => ({ id: newResumeId("bullet"), text, source_ids: [] }),
      );
    }
    updateSection(section.id, {
      entries: [...section.entries, entry],
      ...(preserveText ? { content_md: "" } : {}),
    });
  }
  const active = document.sections.filter(
    (section) => section.enabled && hasSectionContent(section),
  );
  const reviewed = active.filter(
    (section) => section.review_state === "reviewed",
  );
  const tabs = [
    ...(contactPanel ? [{ id: "contact", label: "Contact information" }] : []),
    ...document.sections.map((section) => ({
      id: `section:${section.id}`,
      label: section.heading || "Untitled section",
    })),
    ...(referencePanel ? [{ id: "extracted", label: "Extracted text" }] : []),
  ];
  const selectedTab =
    tabs.find((tab) => tab.id === selectedId)?.id ?? tabs[0]?.id;
  const selectedSection = document.sections.find(
    (section) => `section:${section.id}` === selectedTab,
  );
  function selectTab(id: string) {
    setSelectedId(id);
    setEditingId(null);
  }
  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next: number;
    if (["ArrowDown", "ArrowRight"].includes(event.key))
      next = (index + 1) % tabs.length;
    else if (["ArrowUp", "ArrowLeft"].includes(event.key))
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next].id);
    window.document
      .getElementById(`${workbenchId}-tab-${tabs[next].id}`)
      ?.focus();
  }
  const anchor = (id: string) => `${workbenchId}-section-${id}`;
  return (
    <div className="resume-workbench" data-testid="resume-section-workbench">
      <aside className="resume-index">
        <div className="resume-index-inner">
          <Heading level={2}>
            {source ? "Review your resume" : "Resume sections"}
          </Heading>
          <div
            role="tablist"
            aria-label="Resume sections"
            aria-orientation={verticalTabs ? "vertical" : "horizontal"}
            className="resume-section-links"
          >
            {tabs.map((tab, index) => {
              const section = document.sections.find(
                (item) => `section:${item.id}` === tab.id,
              );
              return (
                <Button
                  variant="ghost"
                  key={tab.id}
                  id={`${workbenchId}-tab-${tab.id}`}
                  role="tab"
                  type="button"
                  aria-label={tab.label}
                  aria-selected={selectedTab === tab.id}
                  tabIndex={selectedTab === tab.id ? 0 : -1}
                  aria-controls={anchor(tab.id)}
                  className={
                    tab.id === "extracted" ? "resume-reference-tab" : undefined
                  }
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => handleTabKey(event, index)}
                >
                  <span className="resume-index-number">
                    {tab.id === "extracted"
                      ? "↗"
                      : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="resume-index-label" title={tab.label}>{tab.label}</span>
                  {section && (
                    <span
                      className={`resume-index-dot ${!section.enabled ? "excluded" : source ? section.review_state === "reviewed" ? "reviewed" : "pending" : ""}`}
                      aria-label={
                        !section.enabled
                          ? "Excluded"
                          : source
                            ? section.review_state === "reviewed"
                              ? "Section reviewed"
                              : "Section needs review"
                            : "Included"
                      }
                    />
                  )}
                </Button>
              );
            })}
          </div>
          {source && (
            <div className="resume-review-summary">
              <Text
                as="p"
                display="block"
                type="supporting"
                aria-live="polite"
              >
                {reviewed.length} of {active.length} populated sections reviewed
              </Text>
              <progress
                className="resume-review-progress"
                aria-label="Source section review progress"
                max={Math.max(active.length, 1)}
                value={reviewed.length}
              />
            </div>
          )}
        </div>
      </aside>
      <div className="resume-sheet">
        {tabs
          .filter((tab) => tab.id !== selectedTab)
          .map((tab) => (
            <section
              key={tab.id}
              hidden
              role="tabpanel"
              id={anchor(tab.id)}
              aria-labelledby={`${workbenchId}-tab-${tab.id}`}
            />
          ))}
        {selectedTab === "contact" && (
          <section
            id={anchor("contact")}
            role="tabpanel"
            aria-labelledby={`${workbenchId}-tab-contact`}
            tabIndex={0}
            className="resume-section"
          >
            {contactPanel}
          </section>
        )}
        {selectedTab === "extracted" && (
          <section
            id={anchor("extracted")}
            role="tabpanel"
            aria-labelledby={`${workbenchId}-tab-extracted`}
            tabIndex={0}
            className="resume-section"
          >
            {referencePanel}
          </section>
        )}
        {document.sections.length === 0 && (
          <div className="resume-empty">
            <Heading level={3}>
              Build your source resume one section at a time
            </Heading>
            <Text
              as="p"
              display="block"
              type="body"
              className="mt-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Start with experience, education, projects, or skills. Add any
              other section you need.
            </Text>
          </div>
        )}
        {document.sections.map(
          (section, index) =>
            selectedSection?.id === section.id && (
              <section
                key={section.id}
                id={anchor(`section:${section.id}`)}
                className={`resume-section ${section.enabled ? "" : "resume-section-excluded"}`}
                role="tabpanel"
                aria-labelledby={`${workbenchId}-tab-section:${section.id}`}
                data-section-id={section.id}
                aria-label={section.heading || "Untitled section"}
                tabIndex={0}
                onDoubleClick={(event) => {
                  if (
                    !disabled &&
                    editingId !== section.id &&
                    !(event.target as HTMLElement).closest(
                      "button, a, input, select, textarea, summary",
                    )
                  )
                    setEditingId(section.id);
                }}
              >
                <div className="resume-section-header">
                  <div className="min-w-0 flex-1">
                    {editingId === section.id ? (
                      <>
                        <Label
                          className="sr-only"
                          htmlFor={`heading-${section.id}`}
                        >
                          Section heading {index + 1}
                        </Label>
                        <Input
                          autoFocus
                          id={`heading-${section.id}`}
                          maxLength={120}
                          className="resume-section-heading"
                          disabled={disabled}
                          value={section.heading}
                          onChange={(event) =>
                            updateSection(section.id, {
                              heading: event.target.value,
                            })
                          }
                        />
                      </>
                    ) : (
                      <Heading
                        level={3}
                        className="resume-section-heading break-words"
                      >
                        {section.heading || "Untitled section"}
                      </Heading>
                    )}
                    <div
                      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <span>
                        {SECTION_LABELS[section.kind]}
                        {section.entries.length > 0
                          ? ` · ${section.entries.length} ${section.kind === "professional_experience" ? (section.entries.length === 1 ? "role" : "roles") : section.entries.length === 1 ? "entry" : "entries"}`
                          : ""}
                      </span>
                      {source && (
                        <span
                          className="resume-review-state"
                          data-reviewed={section.review_state === "reviewed"}
                        >
                          {section.review_state === "reviewed"
                            ? "Reviewed"
                            : "Needs review"}
                        </span>
                      )}
                      {!section.enabled && <span className="resume-excluded-label">Excluded from resume</span>}
                    </div>
                  </div>
                  <ActionButtons label={`${section.heading} controls`} size="sm" primaryIndex={0}>
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      disabled={disabled && editingId !== section.id}
                      aria-label={`${editingId === section.id ? "Preview" : "Edit"} ${section.heading}`}
                      aria-expanded={editingId === section.id}
                      onClick={() =>
                        setEditingId(
                          editingId === section.id ? null : section.id,
                        )
                      }
                    >
                      {editingId === section.id ? (
                        <Check size={14} />
                      ) : (
                        <Pencil size={14} />
                      )}
                      {editingId === section.id ? "Preview" : "Edit"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      aria-label={`Include ${section.heading}`}
                      aria-pressed={section.enabled}
                      disabled={disabled}
                      onClick={() => updateSection(section.id, { enabled: !section.enabled }, false)}
                    >
                      {section.enabled && <Check size={14} aria-hidden="true" />}
                      Include
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      disabled={disabled || index === 0}
                      aria-label={`Move ${section.heading} up`}
                      onClick={() => moveSection(index, -1)}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      disabled={
                        disabled || index === document.sections.length - 1
                      }
                      aria-label={`Move ${section.heading} down`}
                      onClick={() => moveSection(index, 1)}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    {section.kind === "custom" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        type="button"
                        disabled={disabled}
                        aria-label={`Remove ${section.heading}`}
                        onClick={() =>
                          onChange({
                            ...document,
                            sections: document.sections.filter(
                              (item) => item.id !== section.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </ActionButtons>
                </div>
                {editingId === section.id && source && (
                  <details className="resume-section-settings">
                    <summary>Section settings</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs">
                        <span>Section type</span>
                        <Select
                          className="mt-1"
                          disabled={disabled}
                          value={section.kind}
                          onChange={(event) =>
                            updateSection(section.id, {
                              kind: event.target.value as ResumeSectionKind,
                              ...(section.entries.length
                                ? {
                                    content_md: renderSectionContent(section),
                                    entries: [],
                                  }
                                : {}),
                            })
                          }
                        >
                          {Object.entries(SECTION_LABELS).map(
                            ([kind, label]) => (
                              <option key={kind} value={kind}>
                                {label}
                              </option>
                            ),
                          )}
                        </Select>
                      </label>
                      <Text
                        as="p"
                        display="block"
                        type="supporting"
                        className="self-center"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        {section.confidence !== null
                          ? `Import match ${Math.round(section.confidence * 100)}%. This describes the section type, not the accuracy of its facts.`
                          : "Choose the type that matches this content."}{" "}
                        Changing type preserves entry content as text for
                        review.
                      </Text>
                    </div>
                  </details>
                )}
                {source &&
                  section.kind === "professional_experience" &&
                  !section.entries.length &&
                  section.content_md.trim() && (
                    <Text
                      as="p"
                      display="block"
                      type="supporting"
                      className="resume-import-warning my-3"
                    >
                      These jobs are still source text. Check each job boundary
                      before marking reviewed. Add roles to organize them; the
                      original text will stay in the first role for you to
                      split.
                    </Text>
                  )}
                {processing?.sectionId === section.id && !processing.entryId ? (
                  processing.content
                ) : editingId === section.id ? (
                  <>
                    {section.entries.length === 0 && (
                      <div className="my-4">
                        <Label htmlFor={`content-${section.id}`}>
                          Section content{" "}
                          <span className="font-normal">
                            · Markdown supported
                          </span>
                        </Label>
                        <GrowingTextarea
                          id={`content-${section.id}`}
                          disabled={disabled}
                          rows={6}
                          value={section.content_md}
                          placeholder="Write the content for this section…"
                          onChange={(event) =>
                            updateSection(section.id, {
                              content_md: event.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                    <div>
                      {section.entries.map((entry, entryIndex) => (
                        <EntryEditor
                          key={entry.id}
                          entry={entry}
                          index={entryIndex}
                          kind={section.kind}
                          disabled={disabled}
                          onChange={(updated) =>
                            updateSection(section.id, {
                              entries: section.entries.map((item) =>
                                item.id === entry.id ? updated : item,
                              ),
                            })
                          }
                          onRemove={() =>
                            updateSection(section.id, {
                              entries: section.entries.filter(
                                (item) => item.id !== entry.id,
                              ),
                            })
                          }
                          onRegenerate={
                            onRegenerate &&
                            section.kind === "professional_experience" &&
                            section.enabled
                              ? () => onRegenerate(section, entry.id)
                              : undefined
                          }
                          regenerationDisabled={
                            canRegenerate
                              ? !canRegenerate(section, entry.id)
                              : false
                          }
                          regenerationReason={regenerationReason?.(
                            section,
                            entry.id,
                          )}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <ResumeSectionPreview
                    section={section}
                    processing={processing?.sectionId === section.id ? processing : undefined}
                    disabled={disabled}
                    onRegenerate={
                      onRegenerate &&
                      section.kind === "professional_experience" &&
                      section.enabled
                        ? (entryId) => onRegenerate(section, entryId)
                        : undefined
                    }
                    canRegenerate={
                      canRegenerate
                        ? (entryId) => canRegenerate(section, entryId)
                        : undefined
                    }
                    regenerationReason={
                      regenerationReason
                        ? (entryId) => regenerationReason(section, entryId)
                        : undefined
                    }
                  />
                )}
                {source &&
                  hasSectionContent(section) &&
                  sourceSectionReviewError(section) && (
                    <Text
                      as="p"
                      display="block"
                      type="supporting"
                      className="mt-3"
                      style={{ color: "var(--color-warning)" }}
                    >
                      {sourceSectionReviewError(section)}
                    </Text>
                  )}
                <div className="resume-section-footer">
                  <div className="flex flex-wrap gap-2">
                    <ActionButtons label="Section actions" size="sm">
                      {[
                        "professional_experience",
                        "education",
                        "projects",
                        "certifications",
                      ].includes(section.kind) && (
                        <Button
                          size="sm"
                          type="button"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => addEntry(section)}
                        >
                          <Plus size={13} /> Add{" "}
                          {section.kind === "professional_experience"
                            ? "role"
                            : "entry"}
                        </Button>
                      )}
                      {source && (
                        <Button
                          size="sm"
                          variant="secondary"
                          type="button"
                          disabled={
                            disabled ||
                            Boolean(sourceSectionReviewError(section)) ||
                            section.review_state === "reviewed"
                          }
                          onClick={() =>
                            updateSection(
                              section.id,
                              { review_state: "reviewed" },
                              false,
                            )
                          }
                        >
                          <Check size={13} /> Mark reviewed
                        </Button>
                      )}

                    </ActionButtons>
</div>
                  {onRegenerate && (
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      disabled={
                        disabled ||
                        !section.enabled ||
                        (canRegenerate ? !canRegenerate(section) : false)
                      }
                      title={regenerationReason?.(section) ?? undefined}
                      onClick={() => onRegenerate(section)}
                    >
                      <RefreshCw size={13} /> Regenerate section
                    </Button>
                  )}
                </div>
                {onRegenerate && regenerationReason?.(section) && (
                  <Text
                    as="p"
                    display="block"
                    type="supporting"
                    className="mt-2"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {regenerationReason(section)}
                  </Text>
                )}
              </section>
            ),
        )}
        <div className="resume-add-section">
          <label
            className="sr-only"
            htmlFor={`${workbenchId}-add-section-kind`}
          >
            New section type
          </label>
          <Select
            id={`${workbenchId}-add-section-kind`}
            disabled={disabled}
            value={newKind}
            onChange={(event) =>
              setNewKind(event.target.value as ResumeSectionKind)
            }
          >
            {Object.entries(SECTION_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              const section = createResumeSection(newKind);
              onChange({
                ...document,
                sections: [...document.sections, section],
              });
              setSelectedId(`section:${section.id}`);
              setEditingId(section.id);
            }}
          >
            <Plus size={14} /> Add section
          </Button>
        </div>
      </div>
    </div>
  );
}
