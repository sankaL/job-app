import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCard } from "@/components/ui/skeleton";
import { fetchProfile, updateProfile, type ProfileData } from "@/lib/api";

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  professional_experience: "Professional Experience",
  education: "Education",
  skills: "Skills",
};

const DEFAULT_SECTIONS = ["summary", "professional_experience", "education", "skills"];

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [sectionPreferences, setSectionPreferences] = useState<Record<string, boolean>>({});
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [originalState, setOriginalState] = useState<{
    name: string;
    phone: string;
    address: string;
    linkedinUrl: string;
    sectionPreferences: Record<string, boolean>;
    sectionOrder: string[];
  } | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchProfile()
      .then((response) => {
        setProfile(response);
        setName(response.name ?? "");
        setEmail(response.email);
        setPhone(response.phone ?? "");
        setAddress(response.address ?? "");
        setLinkedinUrl(response.linkedin_url ?? "");
        setSectionPreferences(response.section_preferences ?? {});
        setSectionOrder(response.section_order?.length ? response.section_order : DEFAULT_SECTIONS);
        setOriginalState({
          name: response.name ?? "",
          phone: response.phone ?? "",
          address: response.address ?? "",
          linkedinUrl: response.linkedin_url ?? "",
          sectionPreferences: response.section_preferences ?? {},
          sectionOrder: response.section_order?.length ? response.section_order : DEFAULT_SECTIONS,
        });
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load profile"))
      .finally(() => setIsLoading(false));
  }, []);

  const isDirty = originalState
    ? name !== originalState.name ||
      phone !== originalState.phone ||
      address !== originalState.address ||
      linkedinUrl !== originalState.linkedinUrl ||
      JSON.stringify(sectionPreferences) !== JSON.stringify(originalState.sectionPreferences) ||
      JSON.stringify(sectionOrder) !== JSON.stringify(originalState.sectionOrder)
    : false;

  function handleToggleSection(sectionKey: string) {
    setSectionPreferences((c) => ({ ...c, [sectionKey]: !c[sectionKey] }));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const newOrder = [...sectionOrder];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setSectionOrder(newOrder);
  }

  function handleMoveDown(index: number) {
    if (index === sectionOrder.length - 1) return;
    const newOrder = [...sectionOrder];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setSectionOrder(newOrder);
  }

  async function handleSave() {
    setSaveState("saving");
    setError(null);
    try {
      const response = await updateProfile({
        name: name || null,
        phone: phone || null,
        address: address || null,
        linkedin_url: linkedinUrl || null,
        section_preferences: sectionPreferences,
        section_order: sectionOrder,
      });
      setProfile(response);
      setName(response.name ?? "");
      setPhone(response.phone ?? "");
      setAddress(response.address ?? "");
      setLinkedinUrl(response.linkedin_url ?? "");
      setSectionPreferences(response.section_preferences ?? {});
      setSectionOrder(response.section_order?.length ? response.section_order : DEFAULT_SECTIONS);
      setOriginalState({
        name: response.name ?? "",
        phone: response.phone ?? "",
        address: response.address ?? "",
        linkedinUrl: response.linkedin_url ?? "",
        sectionPreferences: response.section_preferences ?? {},
        sectionOrder: response.section_order?.length ? response.section_order : DEFAULT_SECTIONS,
      });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
      setSaveState("idle");
    }
  }

    if (isLoading) {
      return (
        <div className="page-enter space-y-5">
          <PageHeader title="Profile & Preferences" subtitle="Manage your personal information and resume settings" />
        <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <SkeletonCard density="compact" />
            <SkeletonCard density="compact" />
          </div>
        </div>
      );
  }

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Profile & Preferences"
        subtitle="Manage your personal information and resume section preferences"
        actions={
          <div className="flex items-center gap-3">
            {saveState === "saved" && <span className="text-xs" style={{ color: "var(--color-spruce)" }}>Saved</span>}
            <Button disabled={!isDirty || saveState === "saving"} loading={saveState === "saving"} onClick={handleSave}>
              {saveState === "saving" ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      />

      {error && (
        <Card variant="danger" density="compact">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Error</p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{error}</p>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* Personal Information */}
        <Card density="compact">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Personal Information</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--color-ink-40)" }}>Used in generated resumes.</p>
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} disabled className="cursor-not-allowed opacity-60" />
              <p className="mt-1 text-[10px]" style={{ color: "var(--color-ink-40)" }}>Managed through your account.</p>
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" placeholder="Your phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="address">Location</Label>
              <Input id="address" placeholder="City, Province/State" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="linkedin_url">LinkedIn</Label>
              <Input
                id="linkedin_url"
                placeholder="https://linkedin.com/in/your-handle"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Section Preferences */}
        <Card density="compact">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Section Preferences</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--color-ink-40)" }}>Changes apply to future generations only.</p>
          <div className="mt-4 space-y-1">
            {sectionOrder.map((sectionKey, index) => (
              <div key={sectionKey} className="flex items-center justify-between rounded-lg py-2.5 px-3 transition-colors" style={{ borderBottom: index < sectionOrder.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={sectionPreferences[sectionKey] !== false} onChange={() => handleToggleSection(sectionKey)} style={{ accentColor: "var(--color-spruce)" }} />
                  <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                    {SECTION_LABELS[sectionKey] ?? sectionKey}
                  </span>
                </label>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => handleMoveUp(index)} disabled={index === 0} className="rounded p-1 transition-colors disabled:opacity-30" style={{ color: "var(--color-ink-40)" }} aria-label={`Move ${SECTION_LABELS[sectionKey] ?? sectionKey} up`}>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button type="button" onClick={() => handleMoveDown(index)} disabled={index === sectionOrder.length - 1} className="rounded p-1 transition-colors disabled:opacity-30" style={{ color: "var(--color-ink-40)" }} aria-label={`Move ${SECTION_LABELS[sectionKey] ?? sectionKey} down`}>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
