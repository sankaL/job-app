import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import {
  createApplication,
  listApplications,
  patchApplication,
  type ApplicationSummary,
} from "@/lib/api";

type SortMode = "newest" | "oldest";

export function ApplicationsDashboardPage() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [jobUrl, setJobUrl] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    listApplications()
      .then(setApplications)
      .catch((requestError: Error) => setError(requestError.message));
  }, []);

  const sourceApplications = applications ?? [];
  const searchTerm = deferredSearch.trim().toLowerCase();
  const filteredApplications = sourceApplications.filter((application) => {
    const matchesSearch =
      !searchTerm ||
      application.job_title?.toLowerCase().includes(searchTerm) ||
      application.company?.toLowerCase().includes(searchTerm);
    const matchesStatus = statusFilter === "all" ? true : application.visible_status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const sortedApplications =
    sortMode === "oldest" ? [...filteredApplications].reverse() : filteredApplications;

  async function handleCreateApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsCreating(true);

    try {
      const detail = await createApplication(jobUrl);
      navigate(`/app/applications/${detail.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create application.");
      setIsCreating(false);
      return;
    }
  }

  async function handleAppliedToggle(applicationId: string, applied: boolean) {
    if (!applications) {
      return;
    }

    const previous = applications;
    setApplications(
      applications.map((application) =>
        application.id === applicationId ? { ...application, applied } : application,
      ),
    );

    try {
      const detail = await patchApplication(applicationId, { applied });
      setApplications(
        previous.map((application) =>
          application.id === applicationId
            ? {
                ...application,
                applied: detail.applied,
                visible_status: detail.visible_status,
                internal_state: detail.internal_state,
                failure_reason: detail.failure_reason,
                updated_at: detail.updated_at,
                has_action_required_notification: detail.has_action_required_notification,
                duplicate_resolution_status: detail.duplicate_resolution_status,
                has_unresolved_duplicate: detail.duplicate_resolution_status === "pending",
              }
            : application,
        ),
      );
    } catch (requestError) {
      setApplications(previous);
      setError(requestError instanceof Error ? requestError.message : "Unable to update applied state.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="bg-white/80">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Applications</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Dashboard</h2>
            <p className="mt-3 max-w-2xl text-ink/65">
              New applications start from a job URL, move through extraction, and surface manual
              recovery or duplicate review directly in the workflow.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => navigate("/app/extension")}
            >
              Connect Chrome Extension
            </Button>
          </div>
          <form className="flex w-full max-w-xl flex-col gap-3 sm:flex-row" onSubmit={handleCreateApplication}>
            <Input
              aria-label="Job URL"
              placeholder="Paste a job posting URL"
              type="url"
              value={jobUrl}
              onChange={(event) => setJobUrl(event.target.value)}
              required
            />
            <Button className="sm:min-w-44" disabled={isCreating} type="submit">
              {isCreating ? "Creating…" : "New Application"}
            </Button>
          </form>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <Input
            aria-label="Search applications"
            placeholder="Search by title or company"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Filter by status"
            className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="needs_action">Needs Action</option>
            <option value="in_progress">In Progress</option>
            <option value="complete">Complete</option>
          </select>
          <select
            aria-label="Sort applications"
            className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="newest">Recently updated</option>
            <option value="oldest">Oldest updated</option>
          </select>
        </div>
      </Card>

      {error ? (
        <Card className="border-ember/20 bg-ember/5 text-ember">
          <p className="font-semibold">Dashboard request failed</p>
          <p className="mt-2 text-base">{error}</p>
        </Card>
      ) : null}

      {applications === null ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="animate-pulse bg-white/70">
              <div className="h-4 w-28 rounded bg-black/10" />
              <div className="mt-4 h-8 w-2/3 rounded bg-black/10" />
              <div className="mt-4 h-4 w-full rounded bg-black/10" />
              <div className="mt-3 h-4 w-4/5 rounded bg-black/10" />
            </Card>
          ))}
        </div>
      ) : sortedApplications.length === 0 ? (
        <Card className="bg-canvas">
          <p className="text-sm uppercase tracking-[0.18em] text-ink/45">
            {applications.length === 0 ? "No applications yet" : "No matches"}
          </p>
          <h3 className="mt-3 font-display text-3xl text-ink">
            {applications.length === 0
              ? "Paste a job URL to start your first application."
              : "Adjust the current search or status filter."}
          </h3>
          <p className="mt-3 text-ink/65">
            The extraction pipeline will create the draft immediately and push you into the detail
            page for progress, manual recovery, or duplicate review.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sortedApplications.map((application) => (
            <Card
              key={application.id}
              className="cursor-pointer transition hover:border-spruce/30"
              onClick={() => navigate(`/app/applications/${application.id}`)}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={application.visible_status} />
                    {application.has_action_required_notification ? (
                      <span className="rounded-full bg-ember/10 px-3 py-1 text-xs font-semibold text-ember">
                        Attention Required
                      </span>
                    ) : null}
                    {application.has_unresolved_duplicate ? (
                      <span className="rounded-full bg-spruce/10 px-3 py-1 text-xs font-semibold text-spruce">
                        Duplicate Review
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-4 truncate font-display text-3xl text-ink">
                    {application.job_title ?? "Awaiting extracted title"}
                  </h3>
                  <p className="mt-2 text-lg text-ink/70">
                    {application.company ?? "Company still missing from extraction"}
                  </p>
                  <a
                    className="mt-4 inline-flex text-sm font-medium text-spruce hover:text-ink"
                    href={application.job_url}
                    onClick={(event) => event.stopPropagation()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open source job link
                  </a>
                </div>

                <div className="grid gap-3 text-sm text-ink/65 lg:min-w-64">
                  <label
                    className="inline-flex items-center gap-2 font-medium text-ink"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      checked={application.applied}
                      type="checkbox"
                      onChange={(event) => {
                        void handleAppliedToggle(application.id, event.target.checked);
                      }}
                    />
                    Applied
                  </label>
                  <div>Updated {new Date(application.updated_at).toLocaleString()}</div>
                  <div>Created {new Date(application.created_at).toLocaleDateString()}</div>
                  <div>{application.base_resume_name ?? "No base resume selected yet"}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
