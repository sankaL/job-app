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

export async function fetchSessionBootstrap(): Promise<SessionBootstrapResponse> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Missing authenticated session.");
  }

  const response = await fetch(`${env.VITE_API_URL}/api/session/bootstrap`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!response.ok) {
    throw new Error("Unable to bootstrap authenticated session.");
  }

  return response.json();
}
