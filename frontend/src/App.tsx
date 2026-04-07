import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/routes/AppShell";
import { ApplicationDetailPage } from "@/routes/ApplicationDetailPage";
import { ApplicationsDashboardPage } from "@/routes/ApplicationsDashboardPage";
import { ExtensionPage } from "@/routes/ExtensionPage";
import { LoginPage } from "@/routes/LoginPage";
import { ProtectedRoute } from "@/routes/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
        >
        <Route index element={<ApplicationsDashboardPage />} />
        <Route path="applications/:applicationId" element={<ApplicationDetailPage />} />
        <Route path="extension" element={<ExtensionPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
