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
    name: string | null;
    phone: string | null;
    address: string | null;
    default_base_resume_id: string | null;
    section_preferences: Record<string, boolean>;
    section_order: string[];
    created_at: string;
    updated_at: string;
  } | null;
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
};

export type ResumeDraft = {
  id: string;
  application_id: string;
  content_md: string;
  generation_params: Record<string, unknown>;
  sections_snapshot: Record<string, unknown>;
  last_generated_at: string;
  last_exported_at: string | null;
  updated_at: string;
};

export type ApplicationDetail = {
  id: string;
  job_url: string;
  job_title: string | null;
  company: string | null;
  job_description: string | null;
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
  name: string | null;
  phone: string | null;
  address: string | null;
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
  section_preferences?: Record<string, boolean>;
  section_order?: string[];
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

export async function createApplication(jobUrl: string): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>("/api/applications", {
    method: "POST",
    body: { job_url: jobUrl },
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
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/generate`, {
    method: "POST",
    body: settings,
  });
}

export async function fetchDraft(applicationId: string): Promise<ResumeDraft | null> {
  return authenticatedRequest<ResumeDraft | null>(`/api/applications/${applicationId}/draft`);
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
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/regenerate`, {
    method: "POST",
    body: settings,
  });
}

export async function triggerSectionRegeneration(
  applicationId: string,
  sectionName: string,
  instructions: string,
): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/regenerate-section`, {
    method: "POST",
    body: { section_name: sectionName, instructions },
  });
}

export async function cancelGeneration(applicationId: string): Promise<ApplicationDetail> {
  return authenticatedRequest<ApplicationDetail>(`/api/applications/${applicationId}/cancel-generation`, {
    method: "POST",
  });
}

export async function exportPdf(applicationId: string): Promise<Blob> {
  const token = await getAccessToken();
  const response = await fetch(`${env.VITE_API_URL}/api/applications/${applicationId}/export-pdf`, {
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

  return response.blob();
}
