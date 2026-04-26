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

// HashRouter avoids file:// routing issues when Electron loads the built bundle
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/test"      element={<RunTestPage />} />
            <Route path="/upload"    element={<LtmsUploadPage />} />
            <Route path="/history"   element={<HistoryPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/test" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
