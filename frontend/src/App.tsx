import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/routes/AppShell";
import { AdminRoute } from "@/routes/AdminRoute";
import { ProtectedRoute } from "@/routes/ProtectedRoute";

const AdminDashboardPage = lazy(() =>
  import("@/routes/AdminDashboardPage").then((module) => ({
    default: module.AdminDashboardPage,
  })),
);
const AdminSubscriptionsPage = lazy(() =>
  import("@/routes/AdminSubscriptionsPage").then((module) => ({
    default: module.AdminSubscriptionsPage,
  })),
);
const AdminUsersPage = lazy(() =>
  import("@/routes/AdminUsersPage").then((module) => ({
    default: module.AdminUsersPage,
  })),
);
const ApplicationDetailPage = lazy(() =>
  import("@/routes/ApplicationDetailPage").then((module) => ({
    default: module.ApplicationDetailPage,
  })),
);
const ApplicationsListPage = lazy(() =>
  import("@/routes/ApplicationsListPage").then((module) => ({
    default: module.ApplicationsListPage,
  })),
);
const BaseResumeEditorPage = lazy(() =>
  import("@/routes/BaseResumeEditorPage").then((module) => ({
    default: module.BaseResumeEditorPage,
  })),
);
const BaseResumesPage = lazy(() =>
  import("@/routes/BaseResumesPage").then((module) => ({
    default: module.BaseResumesPage,
  })),
);
const DashboardPage = lazy(() =>
  import("@/routes/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const ExtensionPage = lazy(() =>
  import("@/routes/ExtensionPage").then((module) => ({
    default: module.ExtensionPage,
  })),
);
const LandingPage = lazy(() =>
  import("@/routes/LandingPage").then((module) => ({
    default: module.LandingPage,
  })),
);
const LoginPage = lazy(() =>
  import("@/routes/LoginPage").then((module) => ({
    default: module.LoginPage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/routes/ProfilePage").then((module) => ({
    default: module.ProfilePage,
  })),
);
const SignupPage = lazy(() =>
  import("@/routes/SignupPage").then((module) => ({
    default: module.SignupPage,
  })),
);

export default function App() {
  return (
    <Suspense
      fallback={
        <div role="status" className="p-6 text-sm">
          Loading application…
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="applications" element={<ApplicationsListPage />} />
          <Route
            path="applications/:applicationId"
            element={<ApplicationDetailPage />}
          />
          <Route path="extension" element={<ExtensionPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="resumes" element={<BaseResumesPage />} />
          <Route path="resumes/new" element={<BaseResumeEditorPage />} />
          <Route path="resumes/:resumeId" element={<BaseResumeEditorPage />} />
          <Route
            path="admin"
            element={
              <AdminRoute>
                <AdminDashboardPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/users"
            element={
              <AdminRoute>
                <AdminUsersPage />
              </AdminRoute>
            }
          />
          <Route
            path="admin/subscriptions"
            element={
              <AdminRoute>
                <AdminSubscriptionsPage />
              </AdminRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
