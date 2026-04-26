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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

const NAV = [
  { to: "/analytics", label: "Analytics" },
  { to: "/centers",   label: "Centers" },
  { to: "/licenses",  label: "Licenses" },
];

function AppShell({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <span className="font-bold text-gray-800 text-sm tracking-wide">PETC Operator Portal</span>
        <nav className="flex gap-1">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100"
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-500 hover:text-gray-800 underline"
        >
          Sign out
        </button>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/analytics"
            element={
              <RequireAuth>
                <AppShell><CrossCenterDashboard /></AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/centers"
            element={
              <RequireAuth>
                <AppShell><CentersPage /></AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/licenses"
            element={
              <RequireAuth>
                <AppShell><LicensesPage /></AppShell>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/analytics" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
