import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonSection } from "@/components/ui/skeleton";
import { updateProfile, type ProfileData } from "@/lib/api";
import { updateBootstrapProfile } from "@/lib/queries";

type EditableProfileState = ReturnType<typeof getEditableProfileState>;

const EMPTY_PROFILE_STATE: EditableProfileState = {
  name: "",
  phone: "",
  address: "",
  linkedinUrl: "",
};

function getEditableProfileState(profile: ProfileData) {
  return {
    name: profile.name ?? "",
    phone: profile.phone ?? "",
    address: profile.address ?? "",
    linkedinUrl: profile.linkedin_url ?? "",
  };
}

function ProfileLoading() {
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Profile & Preferences"
        subtitle="Manage your personal information and resume settings"
      />
      <VStack gap={8} maxWidth={720}>
        <SkeletonSection density="compact" />
        <SkeletonSection density="compact" />
      </VStack>
    </div>
  );
}

function ProfileUnavailable({ error }: { error: string | null }) {
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Profile & Preferences"
        subtitle="Manage your personal information and resume settings"
      />
      <Section variant="danger" density="compact">
        <Text
          as="p"
          display="block"
          type="label"
          className="text-[var(--color-error)]"
        >
          Profile unavailable
        </Text>
        <Text
          as="p"
          display="block"
          type="body"
          className="mt-1 text-[var(--color-text-secondary)]"
        >
          {error ?? "Refresh the page or sign in again."}
        </Text>
      </Section>
    </div>
  );
}

function PersonalInformationSection({
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
    <Section density="compact">
      <Heading level={3} className="text-[var(--color-text-secondary)]">
        Personal Information
      </Heading>
      <Text
        as="p"
        display="block"
        type="supporting"
        className="mt-1 text-[var(--color-text-secondary)]"
      >
        Used in generated resumes.
      </Text>
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
          <Text
            as="p"
            display="block"
            type="supporting"
            className="mt-1 text-[var(--color-text-secondary)]"
          >
            Managed through your account.
          </Text>
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
    </Section>
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
    current.linkedinUrl !== original.linkedinUrl
  );
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
        subtitle="Manage your personal information and resume settings"
        actions={
          <div className="flex items-center gap-3">
            {saveState === "saved" && (
              <span
                className="text-xs"
                style={{ color: "var(--color-accent)" }}
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
        <Section variant="danger" density="compact">
          <Text
            as="p"
            display="block"
            type="label"
            style={{ color: "var(--color-error)" }}
          >
            Error
          </Text>
          <Text
            as="p"
            display="block"
            type="body"
            className="mt-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {error}
          </Text>
        </Section>
      )}

      <VStack gap={8} maxWidth={720}>
        <PersonalInformationSection
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
        <Section density="compact">
          <Heading level={3}>Resume sections</Heading>
          <Text
            as="p"
            display="block"
            type="body"
            className="mt-2 text-[var(--color-text-secondary)]"
          >
            Choose sections and their order in each resume workbench, including
            custom sections. Base resume changes apply to new generations.
            Generated resumes keep their own saved layout.
          </Text>
          <Link
            to="/app/resumes"
            className="mt-3 inline-block text-sm font-semibold underline text-[var(--color-accent)]"
          >
            Manage base resumes
          </Link>
        </Section>
      </VStack>
    </div>
  );
}
