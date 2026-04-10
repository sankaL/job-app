import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";

export function AdminRoute({ children }: PropsWithChildren) {
  const { bootstrap, bootstrapError } = useAppContext();

  if (!bootstrap) {
    if (bootstrapError) {
      return <Navigate to="/app" replace />;
    }
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-medium text-ink/70 shadow-panel">
          Checking admin access…
        </div>
      </div>
    );
  }

  if (!bootstrap.profile?.is_admin) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
