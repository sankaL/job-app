import {
  VStack,
  HStack,
  Layout,
  LayoutContent,
} from "@astryxdesign/core/Layout";
import { Grid } from "@astryxdesign/core/Grid";
import { Divider } from "@astryxdesign/core/Divider";
import { Field } from "@astryxdesign/core/Field";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// Keep the settings template's section spacing and responsive columns,
// using the full available page width without a second navigation rail.
function ProfileSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <Layout
      height="auto"
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>{children}</VStack>
        </LayoutContent>
      }
    />
  );
}

function ProfileLoading() {
  return (
    <VStack className="page-enter">
      <PageHeader title="Profile & Preferences" />
      <ProfileSettingsLayout>
        <SkeletonSection density="compact" />
        <SkeletonSection density="compact" />
      </ProfileSettingsLayout>
    </VStack>
  );
}

function ProfileError({ error }: { error: string }) {
  return (
    <VStack gap={1} role="alert">
      <Text type="label" className="text-error">
        Profile unavailable
      </Text>
      <Text as="p" color="secondary">
        {error}
      </Text>
    </VStack>
  );
}

function ProfileUnavailable({ error }: { error: string | null }) {
  return (
    <VStack className="page-enter">
      <PageHeader title="Profile & Preferences" />
      <ProfileSettingsLayout>
        <ProfileError error={error ?? "Refresh the page or sign in again."} />
      </ProfileSettingsLayout>
    </VStack>
  );
}

function PersonalInformationSection({
  fields,
  email,
  isSaving,
  updateField,
}: {
  fields: EditableProfileState;
  email: string;
  isSaving: boolean;
  updateField: <K extends keyof EditableProfileState>(
    key: K,
    value: EditableProfileState[K],
  ) => void;
}) {
  const isNarrow = useMediaQuery("(max-width: 768px)");
  return (
    <Grid columns={isNarrow ? 1 : { minWidth: 320, max: 2 }} gap={10}>
      <VStack gap={1}>
        <Heading level={3} id="profile-personal-information">
          Personal information
        </Heading>
        <Text type="supporting" color="secondary">
          Your contact details appear in generated resumes and exports.
        </Text>
      </VStack>
      <VStack gap={4}>
        <Field label="Name" inputID="name" isDisabled={isSaving}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Your full name"
            value={fields.name}
            disabled={isSaving}
            onChange={(event) => updateField("name", event.target.value)}
          />
        </Field>
        <Field
          label="Email"
          inputID="email"
          isDisabled
          description="Managed through your account."
          descriptionID="email-help"
        >
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            disabled
            aria-describedby="email-help"
          />
        </Field>
        <Field label="Phone" inputID="phone" isDisabled={isSaving}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="Your phone number"
            value={fields.phone}
            disabled={isSaving}
            onChange={(event) => updateField("phone", event.target.value)}
          />
        </Field>
        <Field label="Location" inputID="address" isDisabled={isSaving}>
          <Input
            id="address"
            name="address"
            placeholder="City, Province/State"
            value={fields.address}
            disabled={isSaving}
            onChange={(event) => updateField("address", event.target.value)}
          />
        </Field>
        <Field label="LinkedIn" inputID="linkedin_url" isDisabled={isSaving}>
          <Input
            id="linkedin_url"
            name="linkedin_url"
            placeholder="https://linkedin.com/in/your-handle"
            value={fields.linkedinUrl}
            disabled={isSaving}
            onChange={(event) => updateField("linkedinUrl", event.target.value)}
          />
        </Field>
      </VStack>
    </Grid>
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
    if (!isProfileDirty(fields, original) || saveState === "saving") return;
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
  const {
    profile,
    fields,
    saveState,
    error,
    isLoading,
    isDirty,
    updateField,
    save,
  } = useProfileEditor();
  const isNarrow = useMediaQuery("(max-width: 768px)");

  if (isLoading) return <ProfileLoading />;
  if (!profile) return <ProfileUnavailable error={error} />;

  return (
    <VStack className="page-enter">
      <PageHeader
        title="Profile & Preferences"
        actions={
          <HStack gap={3} vAlign="center">
            <Text
              type="supporting"
              color="secondary"
              role="status"
              aria-live="polite"
            >
              {saveState === "saved"
                ? "Saved"
                : isDirty
                  ? "Unsaved changes"
                  : ""}
            </Text>
            <Button
              type="submit"
              form="profile-settings-form"
              disabled={!isDirty || saveState === "saving"}
              loading={saveState === "saving"}
            >
              {saveState === "saving" ? "Saving…" : "Save"}
            </Button>
          </HStack>
        }
      />
      <form
        id="profile-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ProfileSettingsLayout>
          {error && (
            <VStack gap={1} role="alert">
              <Text type="label" className="text-error">
                Could not save profile
              </Text>
              <Text as="p" color="secondary">
                {error}
              </Text>
            </VStack>
          )}
          <PersonalInformationSection
            fields={fields}
            email={profile.email}
            isSaving={saveState === "saving"}
            updateField={updateField}
          />
          <Divider />
          <Grid columns={isNarrow ? 1 : { minWidth: 320, max: 2 }} gap={10}>
            <VStack gap={1}>
              <Heading level={3} id="profile-resume-sections">
                Resume sections
              </Heading>
              <Text type="supporting" color="secondary">
                Manage the content and layout in each resume workbench.
              </Text>
            </VStack>
            <VStack gap={4}>
              <Text as="p" color="secondary">
                Choose sections and their order in each resume workbench,
                including custom sections. Base resume changes apply to new
                generations. Generated resumes keep their own saved layout.
              </Text>
              <HStack>
                <Link
                  to="/app/resumes"
                  className="text-sm font-semibold underline"
                >
                  Manage base resumes
                </Link>
              </HStack>
            </VStack>
          </Grid>
        </ProfileSettingsLayout>
      </form>
    </VStack>
  );
}
