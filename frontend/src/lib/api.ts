import { env } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export type SessionBootstrapResponse = {
  user: {
    id: string;
    email: string | null;
    role: string | null;
  };
  profile: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    name: string | null;
    phone: string | null;
    address: string | null;
    linkedin_url: string | null;
    is_admin: boolean;
    is_active: boolean;
    onboarding_completed_at: string | null;
    default_base_resume_id: string | null;
    section_preferences: Record<string, boolean>;
    section_order: string[];
    created_at: string;
    updated_at: string;
  } | null;
  application_summary: {
    total_count: number;
    applied_count: number;
    needs_action_count: number;
  };
  workflow_contract_version: string;
};

export type NotificationSummary = {
  id: string;
  application_id: string | null;
  type: "info" | "success" | "warning" | "error";
  message: string;
  action_required: boolean;
  read: boolean;
  created_at: string;
};

export type MatchedApplication = {
  id: string;
  job_url: string;
  job_title: string | null;
  company: string | null;
  visible_status: string;
};

export type DuplicateWarning = {
  similarity_score: number;
  matched_fields: string[];
  match_basis: string;
  matched_application: MatchedApplication;
};

export type ExtractionFailureDetails = {
  kind: string;
  provider: string | null;
  reference_id: string | null;
  blocked_url: string | null;
  detected_at: string;
};

export type ApplicationSummary = {
  id: string;
  job_url: string;
  job_title: string | null;
  company: string | null;
  job_posting_origin: string | null;
  visible_status: "draft" | "needs_action" | "in_progress" | "complete";
  internal_state: string;
  failure_reason: string | null;
  extraction_failure_details?: ExtractionFailureDetails | null;
  applied: boolean;
  duplicate_similarity_score: number | null;
  duplicate_resolution_status: string | null;
  duplicate_matched_application_id: string | null;
  created_at: string;
  updated_at: string;
  base_resume_name: string | null;
  has_action_required_notification: boolean;
  has_unresolved_duplicate: boolean;
};

export type GenerationFailureDetails = {
  message: string | null;
  validation_errors: string[] | null;
  failure_stage?: string | null;
  attempt_count?: number | null;
  attempts?: Array<{
    model?: string | null;
    reasoning_effort?: string | null;
    transport_mode?: string | null;
    outcome?: string | null;
    elapsed_ms?: number | null;
    retry_reason?: string | null;
  }> | null;
  terminal_error_code?: string | null;
  repair_model?: string | null;
  error?: {
    error_type?: string | null;
    message?: string | null;
  } | null;
  repair_error?: {
    error_type?: string | null;
    message?: string | null;
  } | null;
};

export type ResumeJudgeDimensionScore = {
  score: number;
  weight: number;
  weighted_contribution: number;
  notes: string;
};

export type ResumeJudgeResult = {
  status: "queued" | "running" | "succeeded" | "failed";
  message?: string | null;
  final_score?: number | null;
  display_score?: number | null;
  verdict?: "pass" | "warn" | "fail" | null;
  pass_threshold?: number | null;
  score_summary?: string | null;
  dimension_scores?: Record<string, ResumeJudgeDimensionScore> | null;
  regeneration_instructions?: string | null;
  regeneration_priority_dimensions?: string[];
  evaluator_notes?: string | null;
  evaluated_draft_updated_at?: string | null;
  scored_at?: string | null;
  job_context_signature?: string | null;
  failure_stage?: string | null;
  run_attempt_count?: number | null;
  attempt_count?: number | null;
  attempts?: Array<{
    model?: string | null;
    reasoning_effort?: string | null;
    transport_mode?: string | null;
    outcome?: string | null;
    elapsed_ms?: number | null;
    retry_reason?: string | null;
  }> | null;
  error?: {
    error_type?: string | null;
    message?: string | null;
  } | null;
};

export type ResumeDraft = {
  id: string;
  application_id: string;
  content_md: string;
  generation_params: Record<string, unknown>;
  sections_snapshot: Record<string, unknown>;
  review_flags?: Array<{
    section_name: string;
    text: string;
    reason: "job_description_only_addition";
  }>;
  last_generated_at: string;
  last_exported_at: string | null;
  updated_at: string;
};

export type DownloadResponse = {
  blob: Blob;
  filename: string | null;
};

export type ApplicationDetail = {
  id: string;
  job_url: string;
  job_title: string | null;
  company: string | null;
  job_description: string | null;
  job_location_text: string | null;
  compensation_text: string | null;
  extracted_reference_id: string | null;
  job_posting_origin: string | null;
  job_posting_origin_other_text: string | null;
  base_resume_id: string | null;
  base_resume_name: string | null;
  visible_status: "draft" | "needs_action" | "in_progress" | "complete";
  internal_state: string;
  failure_reason: string | null;
  extraction_failure_details: ExtractionFailureDetails | null;
  generation_failure_details: GenerationFailureDetails | null;
  resume_judge_result: ResumeJudgeResult | null;
  applied: boolean;
  duplicate_similarity_score: number | null;
  duplicate_resolution_status: string | null;
  duplicate_matched_application_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  has_action_required_notification: boolean;
  duplicate_warning: DuplicateWarning | null;
};

export type ExtractionProgress = {
  job_id: string;
  workflow_kind: string;
  state: string;
  message: string;
  percent_complete: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  terminal_error_code: string | null;
};

export type ExtensionConnectionStatus = {
  connected: boolean;
  token_created_at: string | null;
  token_last_used_at: string | null;
};

export type ApplicationEventSnapshot = {
  detail: ApplicationDetail;
  progress: ExtractionProgress | null;
};

export type ApplicationHeartbeat = {
  sent_at: string;
};

export type ExtensionTokenResponse = {
  token: string;
  status: ExtensionConnectionStatus;
};

export type BaseResumeSummary = {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type BaseResumeDetail = {
  id: string;
  name: string;
  content_md: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  needs_review?: boolean;
  import_warning?: string | null;
};

export type ProfileData = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  phone: string | null;
  address: string | null;
  linkedin_url: string | null;
  is_admin: boolean;
  is_active: boolean;
  onboarding_completed_at: string | null;
  default_base_resume_id: string | null;
  section_preferences: Record<string, boolean>;
  section_order: string[];
  created_at: string;
  updated_at: string;
};

export type ProfileUpdatePayload = {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  linkedin_url?: string | null;
  section_preferences?: Record<string, boolean>;
  section_order?: string[];
};

export type InvitePreview = {
  invited_email: string;
  expires_at: string;
};

export type AcceptInvitePayload = {
  token: string;
  email: string;
  password: string;
  confirm_password: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  linkedin_url?: string | null;
};

export type AcceptInviteResponse = {
  user_id: string;
  email: string;
};

export type AdminOperationMetric = {
  total: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
};

export type AdminMetrics = {
  total_users: number;
  active_users: number;
  deactivated_users: number;
  invited_users: number;
  total_applications: number;
  invites_sent: number;
  invites_accepted: number;
  invites_pending: number;
  extraction: AdminOperationMetric;
  generation: AdminOperationMetric;
  regeneration: AdminOperationMetric;
  export: AdminOperationMetric;
};

export type AdminUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  phone: string | null;
  address: string | null;
  linkedin_url: string | null;
  is_admin: boolean;
  is_active: boolean;
  onboarding_completed_at: string | null;
  latest_invite_status: string | null;
  latest_invite_sent_at: string | null;
  latest_invite_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InviteUserPayload = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
};

export type InviteUserResponse = {
  invite_id: string;
  invitee_user_id: string;
  invited_email: string;
  expires_at: string;
};

export type UpdateAdminUserPayload = {
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address?: string | null;
  linkedin_url?: string | null;
};

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

async function getAccessToken() {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Missing authenticated session.");
  }

  return session.access_token;
}

function parseSseChunk(
  chunk: string,
): { event: string; payload: unknown } | null {
  const trimmed = chunk.trim();
  if (!trimmed) {
    return null;
  }

  let eventName = "message";
  const dataLines: string[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    if (rawLine.startsWith(":")) {
      continue;
    }
    if (rawLine.startsWith("event:")) {
      eventName = rawLine.slice("event:".length).trim();
      continue;
    }
    if (rawLine.startsWith("data:")) {
      dataLines.push(rawLine.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    payload: JSON.parse(dataLines.join("\n")),
  };
}

async function authenticatedRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    let detail = "Request failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Request failed.";
    }
    throw new Error(detail);
  }

  return response.json();
}

export async function openApplicationEventStream(
  applicationId: string,
  options: {
    signal: AbortSignal;
    onSnapshot: (snapshot: ApplicationEventSnapshot) => void;
    onProgress: (progress: ExtractionProgress) => void;
    onDetail: (detail: ApplicationDetail) => void;
    onHeartbeat?: (heartbeat: ApplicationHeartbeat) => void;
  },
): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}/api/applications/${applicationId}/events`, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    let detail = "Unable to open live updates.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Unable to open live updates.";
    }
    throw new Error(detail);
  }

  if (!response.body) {
    throw new Error("Live updates are unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const parsed = parseSseChunk(chunk);
      if (!parsed) {
        continue;
      }

      if (parsed.event === "snapshot") {
        options.onSnapshot(parsed.payload as ApplicationEventSnapshot);
        continue;
      }
      if (parsed.event === "progress") {
        options.onProgress(parsed.payload as ExtractionProgress);
        continue;
      }
      if (parsed.event === "detail") {
        options.onDetail(parsed.payload as ApplicationDetail);
        continue;
      }
      if (parsed.event === "heartbeat") {
        options.onHeartbeat?.(parsed.payload as ApplicationHeartbeat);
      }
    }
  }
}

function logGenerationRequest(event: string, payload: Record<string, unknown>) {
  console.info("[generation-request]", { event, ...payload });
}

async function authenticatedUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let detail = "Upload failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Upload failed.";
    }
    throw new Error(detail);
  }

  return response.json();
}

async function unauthenticatedRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    let detail = "Request failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Request failed.";
    }
    throw new Error(detail);
  }

  return response.json();
}

export async function fetchSessionBootstrap(): Promise<SessionBootstrapResponse> {
  return authenticatedRequest<SessionBootstrapResponse>("/api/session/bootstrap");
}

export async function listNotifications(): Promise<NotificationSummary[]> {
  return authenticatedRequest<NotificationSummary[]>("/api/notifications");
}

export async function clearNotifications(): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}/api/notifications`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    let detail = "Clear failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Clear failed.";
    }
    throw new Error(detail);
  }
}

export async function listApplications(): Promise<ApplicationSummary[]> {
  return authenticatedRequest<ApplicationSummary[]>("/api/applications");
}

export type CreateApplicationPayload = {
  job_url: string;
  source_text?: string;
};

export async function createApplication(payload: CreateApplicationPayload): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>("/api/applications", {
    method: "POST",
    body: payload,
  });
}

export async function fetchApplicationDetail(applicationId: string): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}`);
}

export async function patchApplication(
  applicationId: string,
  updates: Record<string, unknown>,
): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}`, {
    method: "PATCH",
    body: updates,
  });
}

export async function deleteApplication(applicationId: string): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}/api/applications/${applicationId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    let detail = "Delete failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Delete failed.";
    }
    throw new Error(detail);
  }
}

export async function cancelExtraction(applicationId: string): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/cancel-extraction`, {
    method: "POST",
  });
}

export async function retryExtraction(applicationId: string): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/retry-extraction`, {
    method: "POST",
  });
}

export async function submitManualEntry(
  applicationId: string,
  payload: Record<string, unknown>,
): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/manual-entry`, {
    method: "POST",
    body: payload,
  });
}

export async function resolveDuplicate(
  applicationId: string,
  resolution: "dismissed" | "redirected",
): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(
    `/api/applications/${applicationId}/duplicate-resolution`,
    {
      method: "POST",
      body: { resolution },
    },
  );
}

export async function fetchApplicationProgress(applicationId: string): Promise<ExtractionProgress> {
  return authenticatedRequest<ExtractionProgress>(`/api/applications/${applicationId}/progress`);
}

export async function recoverApplicationFromSource(
  applicationId: string,
  payload: Record<string, unknown>,
): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/recover-from-source`, {
    method: "POST",
    body: payload,
  });
}

export async function fetchExtensionStatus(): Promise<ExtensionConnectionStatus> {
  return authenticatedRequest<ExtensionConnectionStatus>("/api/extension/status");
}

export async function issueExtensionToken(): Promise<ExtensionTokenResponse> {
  return authenticatedRequest<ExtensionTokenResponse>("/api/extension/token", {
    method: "POST",
  });
}

export async function revokeExtensionToken(): Promise<ExtensionConnectionStatus> {
  return authenticatedRequest<ExtensionConnectionStatus>("/api/extension/token", {
    method: "DELETE",
  });
}

// Base resumes

export async function listBaseResumes(): Promise<BaseResumeSummary[]> {
  return authenticatedRequest<BaseResumeSummary[]>("/api/base-resumes");
}

export async function createBaseResume(name: string, contentMd: string): Promise<BaseResumeDetail> {
  return authenticatedRequest<BaseResumeDetail>("/api/base-resumes", {
    method: "POST",
    body: { name, content_md: contentMd },
  });
}

export async function fetchBaseResume(resumeId: string): Promise<BaseResumeDetail> {
  return authenticatedRequest<BaseResumeDetail>(`/api/base-resumes/${resumeId}`);
}

export async function updateBaseResume(
  resumeId: string,
  updates: { name?: string; content_md?: string },
): Promise<BaseResumeDetail> {
  return authenticatedRequest<BaseResumeDetail>(`/api/base-resumes/${resumeId}`, {
    method: "PATCH",
    body: updates,
  });
}

export async function deleteBaseResume(resumeId: string, force?: boolean): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(
    `${env.VITE_API_URL}/api/base-resumes/${resumeId}?force=${force ?? false}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let detail = "Delete failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Delete failed.";
    }
    throw new Error(detail);
  }
}

export async function setDefaultBaseResume(resumeId: string): Promise<BaseResumeSummary> {
  return authenticatedRequest<BaseResumeSummary>(`/api/base-resumes/${resumeId}/set-default`, {
    method: "POST",
  });
}

export async function uploadBaseResume(
  file: File,
  name: string,
  useLlmCleanup?: boolean,
): Promise<BaseResumeDetail> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);
  if (useLlmCleanup !== undefined) {
    formData.append("use_llm_cleanup", String(useLlmCleanup));
  }
  return authenticatedUpload<BaseResumeDetail>("/api/base-resumes/upload", formData);
}

// Profile

export async function fetchProfile(): Promise<ProfileData> {
  return authenticatedRequest<ProfileData>("/api/profiles");
}

export async function updateProfile(updates: ProfileUpdatePayload): Promise<ProfileData> {
  return authenticatedRequest<ProfileData>("/api/profiles", {
    method: "PATCH",
    body: updates,
  });
}

// Invite Onboarding

export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const params = new URLSearchParams({ token });
  return unauthenticatedRequest<InvitePreview>(`/api/public/invites/preview?${params.toString()}`);
}

export async function acceptInvite(payload: AcceptInvitePayload): Promise<AcceptInviteResponse> {
  return unauthenticatedRequest<AcceptInviteResponse>("/api/public/invites/accept", {
    method: "POST",
    body: payload,
  });
}

// Admin

export async function fetchAdminMetrics(): Promise<AdminMetrics> {
  return authenticatedRequest<AdminMetrics>("/api/admin/metrics");
}

export async function listAdminUsers(params?: {
  search?: string;
  status?: "active" | "invited" | "deactivated";
}): Promise<AdminUser[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return authenticatedRequest<AdminUser[]>(`/api/admin/users${suffix}`);
}

export async function inviteAdminUser(payload: InviteUserPayload): Promise<InviteUserResponse> {
  return authenticatedRequest<InviteUserResponse>("/api/admin/users/invite", {
    method: "POST",
    body: payload,
  });
}

export async function updateAdminUser(userId: string, updates: UpdateAdminUserPayload): Promise<AdminUser> {
  return authenticatedRequest<AdminUser>(`/api/admin/users/${userId}`, {
    method: "PATCH",
    body: updates,
  });
}

export async function deactivateAdminUser(userId: string): Promise<AdminUser> {
  return authenticatedRequest<AdminUser>(`/api/admin/users/${userId}/deactivate`, {
    method: "POST",
  });
}

export async function reactivateAdminUser(userId: string): Promise<AdminUser> {
  return authenticatedRequest<AdminUser>(`/api/admin/users/${userId}/reactivate`, {
    method: "POST",
  });
}

export async function deleteAdminUser(userId: string): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}/api/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    let detail = "Delete failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Delete failed.";
    }
    throw new Error(detail);
  }
}

// Generation

export async function triggerGeneration(
  applicationId: string,
  settings: {
    base_resume_id: string;
    target_length: string;
    aggressiveness: string;
    additional_instructions?: string;
  },
): Promise<ApplicationDetail> {
  logGenerationRequest("start", {
    workflow_kind: "generation",
    application_id: applicationId,
    base_resume_id: settings.base_resume_id,
    target_length: settings.target_length,
    aggressiveness: settings.aggressiveness,
    additional_instructions_length: settings.additional_instructions?.length ?? 0,
  });
  try {
    return await authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/generate`, {
      method: "POST",
      body: settings,
    });
  } catch (error) {
    console.warn("[generation-request]", {
      event: "failure",
      workflow_kind: "generation",
      application_id: applicationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchDraft(applicationId: string): Promise<ResumeDraft | null> {
  return authenticatedRequest<ResumeDraft | null>(`/api/applications/${applicationId}/draft`);
}

export async function triggerResumeJudge(applicationId: string): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/judge`, {
    method: "POST",
  });
}

export async function saveDraft(
  applicationId: string,
  content: string,
): Promise<ResumeDraft> {
  return authenticatedRequest<ResumeDraft>(`/api/applications/${applicationId}/draft`, {
    method: "PUT",
    body: { content },
  });
}

export async function triggerFullRegeneration(
  applicationId: string,
  settings: {
    target_length: string;
    aggressiveness: string;
    additional_instructions?: string;
  },
): Promise<ApplicationDetail> {
  logGenerationRequest("start", {
    workflow_kind: "regeneration_full",
    application_id: applicationId,
    target_length: settings.target_length,
    aggressiveness: settings.aggressiveness,
    additional_instructions_length: settings.additional_instructions?.length ?? 0,
  });
  try {
    return await authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/regenerate`, {
      method: "POST",
      body: settings,
    });
  } catch (error) {
    console.warn("[generation-request]", {
      event: "failure",
      workflow_kind: "regeneration_full",
      application_id: applicationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function triggerSectionRegeneration(
  applicationId: string,
  sectionName: string,
  instructions: string,
): Promise<ApplicationDetail> {
  logGenerationRequest("start", {
    workflow_kind: "regeneration_section",
    application_id: applicationId,
    section_name: sectionName,
    instructions_length: instructions.length,
  });
  try {
    return await authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/regenerate-section`, {
      method: "POST",
      body: { section_name: sectionName, instructions },
    });
  } catch (error) {
    console.warn("[generation-request]", {
      event: "failure",
      workflow_kind: "regeneration_section",
      application_id: applicationId,
      section_name: sectionName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function cancelGeneration(applicationId: string): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/cancel-generation`, {
    method: "POST",
  });
}

function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }
  const unquotedMatch = contentDisposition.match(/filename=([^;]+)/i);
  return unquotedMatch?.[1]?.trim() ?? null;
}

async function exportDownload(applicationId: string, path: string): Promise<DownloadResponse> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}/api/applications/${applicationId}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    let detail = "Export failed.";
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      detail = "Export failed.";
    }
    throw new Error(detail);
  }

  return {
    blob: await response.blob(),
    filename: parseDownloadFilename(response.headers.get("Content-Disposition")),
  };
}

export async function exportPdf(applicationId: string): Promise<DownloadResponse> {
  return exportDownload(applicationId, "export-pdf");
}

export async function exportDocx(applicationId: string): Promise<DownloadResponse> {
  return exportDownload(applicationId, "export-docx");
}
