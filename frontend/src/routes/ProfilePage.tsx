import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCard } from "@/components/ui/skeleton";
import { updateProfile, type ProfileData } from "@/lib/api";
import { updateBootstrapProfile } from "@/lib/queries";

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  professional_experience: "Professional Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
};

const DEFAULT_SECTIONS = [
  "summary",
  "professional_experience",
  "education",
  "skills",
  "projects",
  "certifications",
];

type EditableProfileState = ReturnType<typeof getEditableProfileState>;

const EMPTY_PROFILE_STATE: EditableProfileState = {
  name: "",
  phone: "",
  address: "",
  linkedinUrl: "",
  sectionPreferences: {},
  sectionOrder: [],
};

function getEditableProfileState(profile: ProfileData) {
  return {
    name: profile.name ?? "",
    phone: profile.phone ?? "",
    address: profile.address ?? "",
    linkedinUrl: profile.linkedin_url ?? "",
    sectionPreferences: profile.section_preferences ?? {},
    sectionOrder: profile.section_order?.length
      ? profile.section_order
      : DEFAULT_SECTIONS,
  };
}

function ProfileLoading() {
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Profile & Preferences"
        subtitle="Manage your personal information and resume settings"
      />
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <SkeletonCard density="compact" />
        <SkeletonCard density="compact" />
      </div>
    </div>
  );
}

function ProfileUnavailable({ error }: { error: string | null }) {
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Profile & Preferences"
        subtitle="Manage your personal information and resume section preferences"
      />
      <Card variant="danger" density="compact">
        <p className="text-sm font-semibold text-[var(--color-ember)]">
          Profile unavailable
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-65)]">
          {error ?? "Refresh the page or sign in again."}
        </p>
      </Card>
    </div>
  );
}

function PersonalInformationCard({
  name,
  email,
  phone,
  address,
  linkedinUrl,
  onNameChange,
  onPhoneChange,
  onAddressChange,
  onLinkedinChange,
}: {
  name: string;
  email: string;
  phone: string;
  address: string;
  linkedinUrl: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onLinkedinChange: (value: string) => void;
}) {
  return (
    <Card density="compact">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-40)]">
        Personal Information
      </h3>
      <p className="mt-1 text-xs text-[var(--color-ink-40)]">
        Used in generated resumes.
      </p>
      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="Your full name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            value={email}
            disabled
            className="cursor-not-allowed opacity-60"
          />
          <p className="mt-1 text-[10px] text-[var(--color-ink-40)]">
            Managed through your account.
          </p>
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            placeholder="Your phone number"
            value={phone}
            onChange={(event) => onPhoneChange(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="address">Location</Label>
          <Input
            id="address"
            placeholder="City, Province/State"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="linkedin_url">LinkedIn</Label>
          <Input
            id="linkedin_url"
            placeholder="https://linkedin.com/in/your-handle"
            value={linkedinUrl}
            onChange={(event) => onLinkedinChange(event.target.value)}
          />
        </div>
      </div>
    </Card>
  );
}

function SectionPreferencesCard({
  order,
  preferences,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  order: string[];
  preferences: Record<string, boolean>;
  onToggle: (key: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <Card density="compact">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-40)]">
        Section Preferences
      </h3>
      <p className="mt-1 text-xs text-[var(--color-ink-40)]">
        Changes apply to future generations only.
      </p>
      <div className="mt-4 space-y-1">
        {order.map((sectionKey, index) => {
          const label = SECTION_LABELS[sectionKey] ?? sectionKey;
          return (
            <div
              key={sectionKey}
              className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
              style={{
                borderBottom:
                  index < order.length - 1
                    ? "1px solid var(--color-border)"
                    : "none",
              }}
            >
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={preferences[sectionKey] !== false}
                  onChange={() => onToggle(sectionKey)}
                  style={{ accentColor: "var(--color-spruce)" }}
                />
                <span className="text-sm text-[var(--color-ink)]">{label}</span>
              </label>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onMoveUp(index)}
                  disabled={index === 0}
                  className="rounded p-1 text-[var(--color-ink-40)] transition-colors disabled:opacity-30"
                  aria-label={`Move ${label} up`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 15l7-7 7 7"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => onMoveDown(index)}
                  disabled={index === order.length - 1}
                  className="rounded p-1 text-[var(--color-ink-40)] transition-colors disabled:opacity-30"
                  aria-label={`Move ${label} down`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function isProfileDirty(
  current: EditableProfileState,
  original: EditableProfileState | null,
) {
  if (!original) return false;
  return (
    current.name !== original.name ||
    current.phone !== original.phone ||
    current.address !== original.address ||
    current.linkedinUrl !== original.linkedinUrl ||
    JSON.stringify(current.sectionPreferences) !==
      JSON.stringify(original.sectionPreferences) ||
    JSON.stringify(current.sectionOrder) !==
      JSON.stringify(original.sectionOrder)
  );
}

function moveSection(order: string[], index: number, offset: -1 | 1) {
  const destination = index + offset;
  if (destination < 0 || destination >= order.length) return order;
  const next = [...order];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

function useProfileEditor() {
  const queryClient = useQueryClient();
  const { bootstrap, bootstrapError } = useAppContext();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fields, setFields] =
    useState<EditableProfileState>(EMPTY_PROFILE_STATE);
  const [original, setOriginal] = useState<EditableProfileState | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const syncProfile = (nextProfile: ProfileData) => {
    const next = getEditableProfileState(nextProfile);
    setProfile(nextProfile);
    setFields(next);
    setOriginal(next);
  };
  useEffect(() => {
    const nextProfile = bootstrap?.profile ?? null;
    if (nextProfile) {
      syncProfile(nextProfile);
      setError(null);
      setIsLoading(false);
      return;
    }
    const loadError =
      bootstrapError ??
      (bootstrap
        ? "Profile unavailable. Refresh the page or sign in again."
        : null);
    if (loadError) {
      setProfile(null);
      setOriginal(null);
      setError(loadError);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
  }, [bootstrap, bootstrapError]);
  useEffect(() => {
    if (saveState !== "saved") return;
    const timeoutId = window.setTimeout(() => setSaveState("idle"), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [saveState]);
  const updateField = <K extends keyof EditableProfileState>(
    key: K,
    value: EditableProfileState[K],
  ) => setFields((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaveState("saving");
    setError(null);
    try {
      const response = await updateProfile({
        name: fields.name || null,
        phone: fields.phone || null,
        address: fields.address || null,
        linkedin_url: fields.linkedinUrl || null,
        section_preferences: fields.sectionPreferences,
        section_order: fields.sectionOrder,
      });
      updateBootstrapProfile(queryClient, () => response);
      syncProfile(response);
      setSaveState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
      setSaveState("idle");
    }
  };
  return {
    profile,
    fields,
    saveState,
    error,
    isLoading,
    isDirty: isProfileDirty(fields, original),
    updateField,
    save,
  };
}

export function ProfilePage() {
  const editor = useProfileEditor();
  const {
    profile,
    fields,
    saveState,
    error,
    isLoading,
    isDirty,
    updateField,
    save,
  } = editor;

  if (isLoading) {
    return <ProfileLoading />;
  }

  if (!profile) {
    return <ProfileUnavailable error={error} />;
  }

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Profile & Preferences"
        subtitle="Manage your personal information and resume section preferences"
        actions={
          <div className="flex items-center gap-3">
            {saveState === "saved" && (
              <span
                className="text-xs"
                style={{ color: "var(--color-spruce)" }}
              >
                Saved
              </span>
            )}
            <Button
              disabled={!isDirty || saveState === "saving"}
              loading={saveState === "saving"}
              onClick={() => void save()}
            >
              {saveState === "saving" ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      />

      {error && (
        <Card variant="danger" density="compact">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-ember)" }}
          >
            Error
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
            {error}
          </p>
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <PersonalInformationCard
          name={fields.name}
          email={profile.email}
          phone={fields.phone}
          address={fields.address}
          linkedinUrl={fields.linkedinUrl}
          onNameChange={(value) => updateField("name", value)}
          onPhoneChange={(value) => updateField("phone", value)}
          onAddressChange={(value) => updateField("address", value)}
          onLinkedinChange={(value) => updateField("linkedinUrl", value)}
        />
        <SectionPreferencesCard
          order={fields.sectionOrder}
          preferences={fields.sectionPreferences}
          onToggle={(key) =>
            updateField("sectionPreferences", {
              ...fields.sectionPreferences,
              [key]: !fields.sectionPreferences[key],
            })
          }
          onMoveUp={(index) =>
            updateField(
              "sectionOrder",
              moveSection(fields.sectionOrder, index, -1),
            )
          }
          onMoveDown={(index) =>
            updateField(
              "sectionOrder",
              moveSection(fields.sectionOrder, index, 1),
            )
          }
        />
      </div>
    </div>
  );
}
