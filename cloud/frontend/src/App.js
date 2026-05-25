import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LoginPage from "./pages/auth/LoginPage";
import CentersPage from "./pages/admin/CentersPage";
import LicensesPage from "./pages/licensing/LicensesPage";
import CrossCenterDashboard from "./pages/analytics/CrossCenterDashboard";
import { useAuthStore } from "./store/authStore";
import clsx from "clsx";
const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});
function RequireAuth({ children }) {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    return isAuthenticated ? _jsx(_Fragment, { children: children }) : _jsx(Navigate, { to: "/login", replace: true });
}
const NAV = [
    { to: "/analytics", label: "Analytics" },
    { to: "/centers", label: "Centers" },
    { to: "/licenses", label: "Licenses" },
];
function AppShell({ children }) {
    const logout = useAuthStore((s) => s.logout);
    const navigate = useNavigate();
    const handleLogout = async () => {
        await logout();
        navigate("/login");
    };
    return (_jsxs("div", { className: "min-h-screen bg-gray-50 flex flex-col", children: [_jsxs("header", { className: "bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm", children: [_jsx("span", { className: "font-bold text-gray-800 text-sm tracking-wide", children: "PETC Operator Portal" }), _jsx("nav", { className: "flex gap-1", children: NAV.map(({ to, label }) => (_jsx(NavLink, { to: to, className: ({ isActive }) => clsx("px-4 py-2 rounded-lg text-sm font-medium transition-colors", isActive
                                ? "bg-blue-50 text-blue-700"
                                : "text-gray-600 hover:bg-gray-100"), children: label }, to))) }), _jsx("button", { onClick: handleLogout, className: "text-xs text-gray-500 hover:text-gray-800 underline", children: "Sign out" })] }), _jsx("main", { className: "flex-1", children: children })] }));
}
export default function App() {
    return (_jsx(QueryClientProvider, { client: queryClient, children: _jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/analytics", element: _jsx(RequireAuth, { children: _jsx(AppShell, { children: _jsx(CrossCenterDashboard, {}) }) }) }), _jsx(Route, { path: "/centers", element: _jsx(RequireAuth, { children: _jsx(AppShell, { children: _jsx(CentersPage, {}) }) }) }), _jsx(Route, { path: "/licenses", element: _jsx(RequireAuth, { children: _jsx(AppShell, { children: _jsx(LicensesPage, {}) }) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/analytics", replace: true }) })] }) }) }));
}
