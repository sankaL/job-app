import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(Boolean(data.session));
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(Boolean(session));
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-medium text-ink/70 shadow-panel">
          Checking your invite-only session…
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
