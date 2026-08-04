import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
function RequireAuth({ children }) {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    return isAuthenticated ? _jsx(_Fragment, { children: children }) : _jsx(Navigate, { to: "/login", replace: true });
}
function RequireCommissioning({ children }) {
    const { data: status, isPending, isError } = useQuery({ queryKey: ["sidecar-status"], queryFn: sidecarClient.getStatus, retry: false });
    // Never render an operational route until a sidecar readiness answer exists.
    if (isPending || isError || !status)
        return _jsx(ReadinessLoading, {});
    return status.commissioningRequired ? _jsx(Navigate, { to: "/commissioning", replace: true }) : _jsx(_Fragment, { children: children });
}
function ReadinessLoading() {
    return _jsx("div", { className: "min-h-screen grid place-items-center bg-slate-100 text-sm text-gray-700", children: "Checking PETC readiness\u2026" });
}
export default function App() {
    return (_jsx(QueryClientProvider, { client: queryClient, children: _jsx(HashRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/commissioning", element: _jsx(CommissioningPage, {}) }), _jsxs(Route, { element: _jsx(RequireAuth, { children: _jsx(AppShell, {}) }), children: [_jsx(Route, { path: "/history", element: _jsx(HistoryPage, {}) }), _jsx(Route, { path: "/analytics", element: _jsx(AnalyticsPage, {}) }), _jsx(Route, { path: "/settings", element: _jsx(SettingsPage, {}) }), _jsx(Route, { element: _jsx(RequireCommissioning, { children: _jsx(RunTestPage, {}) }), path: "/test" }), _jsx(Route, { element: _jsx(RequireCommissioning, { children: _jsx(LtmsUploadPage, {}) }), path: "/upload" })] }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/test", replace: true }) })] }) }) }));
}
