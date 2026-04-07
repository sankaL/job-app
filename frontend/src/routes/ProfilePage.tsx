import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [sectionPreferences, setSectionPreferences] = useState<Record<string, boolean>>({});
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [originalState, setOriginalState] = useState<{
    name: string;
    phone: string;
    address: string;
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
        setSectionPreferences(response.section_preferences ?? {});
        setSectionOrder(response.section_order?.length ? response.section_order : DEFAULT_SECTIONS);
        setOriginalState({
          name: response.name ?? "",
          phone: response.phone ?? "",
          address: response.address ?? "",
          sectionPreferences: response.section_preferences ?? {},
          sectionOrder: response.section_order?.length ? response.section_order : DEFAULT_SECTIONS,
        });
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const isDirty = originalState
    ? name !== originalState.name ||
      phone !== originalState.phone ||
      address !== originalState.address ||
      JSON.stringify(sectionPreferences) !== JSON.stringify(originalState.sectionPreferences) ||
      JSON.stringify(sectionOrder) !== JSON.stringify(originalState.sectionOrder)
    : false;

  function handleToggleSection(sectionKey: string) {
    setSectionPreferences((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
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
        section_preferences: sectionPreferences,
        section_order: sectionOrder,
      });
      setProfile(response);
      setName(response.name ?? "");
      setPhone(response.phone ?? "");
      setAddress(response.address ?? "");
      setSectionPreferences(response.section_preferences ?? {});
      setSectionOrder(response.section_order?.length ? response.section_order : DEFAULT_SECTIONS);
      setOriginalState({
        name: response.name ?? "",
        phone: response.phone ?? "",
        address: response.address ?? "",
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
      <div className="flex flex-col gap-6">
        <Card className="animate-pulse">
          <div className="h-4 w-32 rounded bg-black/10" />
          <div className="mt-4 h-10 w-3/4 rounded bg-black/10" />
          <div className="mt-4 h-4 w-full rounded bg-black/10" />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-4xl text-ink">Profile & Preferences</h2>
        <p className="mt-2 text-lg text-ink/65">
          Manage your personal information and resume section preferences.
        </p>
      </div>

      {error ? (
        <Card className="border-ember/20 bg-ember/5 text-ember">
          <p className="font-semibold">Error</p>
          <p className="mt-2 text-base">{error}</p>
        </Card>
      ) : null}

      <Card>
        <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Personal Information</p>
        <p className="mt-1 text-sm text-ink/50">
          This information will be used in your generated resumes.
        </p>
        <div className="mt-5 space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={email}
              disabled
              className="cursor-not-allowed bg-black/5 text-ink/50"
            />
            <p className="mt-1 text-xs text-ink/40">Email is managed through your account settings.</p>
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              placeholder="Your phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              placeholder="Your address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card>
        <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Section Preferences</p>
        <p className="mt-1 text-sm text-ink/50">
          Changes apply to future generations only. Existing drafts are not affected unless you explicitly regenerate.
        </p>
        <div className="mt-5 space-y-2">
          {sectionOrder.map((sectionKey, index) => (
            <div
              key={sectionKey}
              className="flex items-center justify-between gap-4 border-b border-black/5 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sectionPreferences[sectionKey] !== false}
                    onChange={() => handleToggleSection(sectionKey)}
                    className="h-4 w-4 rounded border-black/20 text-spruce focus:ring-spruce/15"
                  />
                  <span className="text-base text-ink">
                    {SECTION_LABELS[sectionKey] ?? sectionKey}
                  </span>
                </label>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  className="rounded p-1 text-ink/40 transition hover:bg-black/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Move ${SECTION_LABELS[sectionKey] ?? sectionKey} up`}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(index)}
                  disabled={index === sectionOrder.length - 1}
                  className="rounded p-1 text-ink/40 transition hover:bg-black/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Move ${SECTION_LABELS[sectionKey] ?? sectionKey} down`}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-4">
        <Button disabled={!isDirty || saveState === "saving"} onClick={handleSave}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}
        </Button>
        {saveState === "saved" ? (
          <span className="text-sm text-spruce">Your changes have been saved.</span>
        ) : null}
      </div>
    </div>
  );
}
