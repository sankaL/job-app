import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/routes/AppShell";
import { AdminDashboardPage } from "@/routes/AdminDashboardPage";
import { AdminRoute } from "@/routes/AdminRoute";
import { AdminUsersPage } from "@/routes/AdminUsersPage";
import { ApplicationDetailPage } from "@/routes/ApplicationDetailPage";
import { ApplicationsListPage } from "@/routes/ApplicationsListPage";
import { BaseResumeEditorPage } from "@/routes/BaseResumeEditorPage";
import { BaseResumesPage } from "@/routes/BaseResumesPage";
import { DashboardPage } from "@/routes/DashboardPage";
import { ExtensionPage } from "@/routes/ExtensionPage";
import { LoginPage } from "@/routes/LoginPage";
import { ProfilePage } from "@/routes/ProfilePage";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { SignupPage } from "@/routes/SignupPage";

export default function App() {
  return (
    <Routes>
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
        <Route path="applications/:applicationId" element={<ApplicationDetailPage />} />
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
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
