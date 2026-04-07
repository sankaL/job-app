import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/routes/AppShell";
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
      />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
