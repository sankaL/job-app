import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fetchAdminMetrics,
  fetchApplicationDetail,
  fetchApplicationProgress,
  fetchDraft,
  fetchSessionBootstrap,
  listAdminUsers,
  listApplications,
  listBaseResumes,
  listNotifications,
  type AdminUser,
  type ProfileData,
  type SessionBootstrapResponse,
} from "@/lib/api";

const THIRTY_SECONDS_MS = 30 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ADMIN_USERS_QUERY_KEY = ["adminUsers"] as const;

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  applications: ["applications"] as const,
  application: (applicationId: string) => ["application", applicationId] as const,
  applicationDraft: (applicationId: string) => ["applicationDraft", applicationId] as const,
  applicationProgress: (applicationId: string) => ["applicationProgress", applicationId] as const,
  baseResumes: ["baseResumes"] as const,
  notifications: ["notifications"] as const,
  adminMetrics: ["adminMetrics"] as const,
  adminUsersRoot: ADMIN_USERS_QUERY_KEY,
  adminUsers: (search: string, status: string) => [...ADMIN_USERS_QUERY_KEY, search, status] as const,
};

export function useBootstrapQuery() {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: fetchSessionBootstrap,
    staleTime: FIVE_MINUTES_MS,
  });
}

export function useApplicationsQuery() {
  return useQuery({
    queryKey: queryKeys.applications,
    queryFn: listApplications,
    staleTime: THIRTY_SECONDS_MS,
  });
}

export function useApplicationDetailQuery(
  applicationId: string | undefined,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.application(applicationId ?? ""),
    queryFn: () => fetchApplicationDetail(applicationId!),
    staleTime: THIRTY_SECONDS_MS,
    enabled: (options?.enabled ?? true) && Boolean(applicationId),
    refetchInterval: options?.refetchInterval,
  });
}

export function useApplicationDraftQuery(applicationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.applicationDraft(applicationId ?? ""),
    queryFn: () => fetchDraft(applicationId!),
    staleTime: THIRTY_SECONDS_MS,
    enabled: enabled && Boolean(applicationId),
  });
}

export function useApplicationProgressQuery(
  applicationId: string | undefined,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.applicationProgress(applicationId ?? ""),
    queryFn: () => fetchApplicationProgress(applicationId!),
    enabled: Boolean(applicationId) && (options?.enabled ?? true),
    staleTime: 0,
    refetchInterval: options?.refetchInterval,
  });
}

export function useBaseResumesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.baseResumes,
    queryFn: listBaseResumes,
    staleTime: FIVE_MINUTES_MS,
    enabled,
  });
}

export function useNotificationsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: listNotifications,
    staleTime: 0,
    enabled,
  });
}

export function useAdminMetricsQuery() {
  return useQuery({
    queryKey: queryKeys.adminMetrics,
    queryFn: fetchAdminMetrics,
    staleTime: ONE_MINUTE_MS,
  });
}

export function useAdminUsersQuery(search: string, status: "all" | "active" | "invited" | "deactivated") {
  return useQuery({
    queryKey: queryKeys.adminUsers(search, status),
    queryFn: () =>
      listAdminUsers({
        search: search.trim() || undefined,
        status: status === "all" ? undefined : status,
      }),
    staleTime: THIRTY_SECONDS_MS,
  });
}

export async function invalidateApplicationQueries(queryClient: QueryClient, applicationId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
    queryClient.invalidateQueries({ queryKey: queryKeys.applications }),
    applicationId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.application(applicationId) })
      : Promise.resolve(),
  ]);
}

export async function invalidateApplicationDraftQueries(queryClient: QueryClient, applicationId: string) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.applicationDraft(applicationId),
  });
}

export async function invalidateBaseResumeQueries(queryClient: QueryClient, applicationId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.baseResumes }),
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
    applicationId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.application(applicationId) })
      : Promise.resolve(),
  ]);
}

export async function invalidateNotificationQueries(queryClient: QueryClient, applicationId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
    queryClient.invalidateQueries({ queryKey: queryKeys.applications }),
    applicationId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.application(applicationId) })
      : Promise.resolve(),
  ]);
}

export function updateBootstrapProfile(
  queryClient: QueryClient,
  updater: (profile: ProfileData | null) => ProfileData | null,
) {
  queryClient.setQueryData<SessionBootstrapResponse | undefined>(queryKeys.bootstrap, (current) => {
    if (!current) {
      return current;
    }
    return {
      ...current,
      profile: updater(current.profile),
    };
  });
}

export function updateAdminUsersCache(
  queryClient: QueryClient,
  search: string,
  status: "all" | "active" | "invited" | "deactivated",
  updater: (users: AdminUser[] | undefined) => AdminUser[] | undefined,
) {
  queryClient.setQueryData<AdminUser[] | undefined>(queryKeys.adminUsers(search, status), updater);
}

export async function invalidateAdminUsersQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.adminUsersRoot,
  });
}
