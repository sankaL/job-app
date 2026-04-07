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

export type ApplicationDetail = {
  id: string;
  job_url: string;
  job_title: string | null;
  company: string | null;
  job_description: string | null;
  job_posting_origin: string | null;
  job_posting_origin_other_text: string | null;
  base_resume_id: string | null;
  base_resume_name: string | null;
  visible_status: "draft" | "needs_action" | "in_progress" | "complete";
  internal_state: string;
  failure_reason: string | null;
  extraction_failure_details: ExtractionFailureDetails | null;
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

export async function fetchSessionBootstrap(): Promise<SessionBootstrapResponse> {
  return authenticatedRequest<SessionBootstrapResponse>("/api/session/bootstrap");
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
