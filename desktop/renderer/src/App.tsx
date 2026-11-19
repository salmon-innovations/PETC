import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "./store/authStore";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/auth/LoginPage";
import RunTestPage from "./pages/test/RunTestPage";
import LtmsUploadPage from "./pages/upload/LtmsUploadPage";
import HistoryPage from "./pages/history/HistoryPage";
import AnalyticsPage from "./pages/analytics/AnalyticsPage";
import SettingsPage from "./pages/settings/SettingsPage";
import CommissioningPage from "./pages/settings/CommissioningPage";
import { sidecarClient } from "./api/sidecarClient";
import { useQuery } from "@tanstack/react-query";

// HashRouter avoids file:// routing issues when Electron loads the built bundle
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireCommissioning({ children }: { children: React.ReactNode }) {
  const { data: status, isPending, isError } = useQuery({ queryKey: ["sidecar-status"], queryFn: sidecarClient.getStatus, retry: false });
  // Never render an operational route until a sidecar readiness answer exists.
  if (isPending || isError || !status) return <ReadinessLoading />;
  return status.commissioningRequired ? <Navigate to="/commissioning" replace /> : <>{children}</>;
}

function ReadinessLoading() {
  return <div className="min-h-screen grid place-items-center bg-slate-100 text-sm text-gray-700">Checking PETC readiness…</div>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/commissioning" element={<CommissioningPage />} />
          <Route
            element={<RequireAuth><AppShell /></RequireAuth>}
          >
            <Route path="/history"   element={<HistoryPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
            <Route element={<RequireCommissioning><RunTestPage /></RequireCommissioning>} path="/test" />
            <Route element={<RequireCommissioning><LtmsUploadPage /></RequireCommissioning>} path="/upload" />
          </Route>
          <Route path="*" element={<Navigate to="/test" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
