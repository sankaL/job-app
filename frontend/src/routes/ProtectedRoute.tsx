import { useEffect, useState, type PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { user, isLoading, ensureSession } = useAuth();
  const [hasCheckedSession, setHasCheckedSession] = useState(false);

  useEffect(() => {
    if (user || hasCheckedSession) {
      return;
    }

    let cancelled = false;

    void ensureSession().finally(() => {
      if (!cancelled) {
        setHasCheckedSession(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ensureSession, hasCheckedSession, user]);

  if (isLoading || !user && !hasCheckedSession) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-medium text-ink/70 shadow-panel">
          Checking your invite-only session…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
