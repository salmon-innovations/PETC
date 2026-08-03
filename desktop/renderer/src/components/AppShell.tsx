import { NavLink, Outlet } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useQuery } from "@tanstack/react-query";
import { sidecarClient } from "../api/sidecarClient";
import type { SidecarStatus } from "../types";
import clsx from "clsx";

const NAV = [
  { to: "/test",     label: "Run Test" },
  { to: "/upload",   label: "LTMS Upload" },
  { to: "/history",  label: "History" },
  { to: "/analytics",label: "Analytics" },
  { to: "/settings", label: "Settings" },
];

export default function AppShell() {
  const { user, logout } = useAuthStore();

  const { data: status } = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: sidecarClient.getStatus,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-52 bg-gray-900 text-white flex flex-col">
        <div className="px-4 py-5 border-b border-gray-700">
          <p className="font-bold text-sm tracking-wide">PETC</p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{user?.fullName}</p>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700 hover:text-white"
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Status indicators */}
        <div className="px-4 py-3 border-t border-gray-700 space-y-1.5 text-xs">
          <StatusDot
            ok={status?.analyzerConnected ?? false}
            label={status?.analyzerConnected ? "Analyzer ready" : "Analyzer offline"}
          />
          <StatusDot
            ok={status?.printerStatus.online ?? false}
            label={status?.printerStatus.online ? "Printer ready" : "Printer offline"}
          />
          {(status?.cloudOutboxPending ?? 0) > 0 && (
            <p className="text-yellow-400">
              {status!.cloudOutboxPending} pending sync
            </p>
          )}
          <WalletIndicator status={status} />
        </div>

        <button
          onClick={logout}
          className="mx-3 mb-4 rounded-md border border-gray-600 py-1.5 text-xs text-gray-400 hover:text-white hover:border-gray-400 transition-colors"
        >
          Sign out
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={clsx("h-2 w-2 rounded-full flex-shrink-0", ok ? "bg-green-400" : "bg-red-500")} />
      <span className={ok ? "text-gray-300" : "text-red-400"}>{label}</span>
    </div>
  );
}

/** Treat a balance older than this as stale rather than current. */
const WALLET_STALE_MS = 2 * 60 * 1000;

/**
 * Prepaid balance, as last reported by the cloud.
 *
 * The value is cached by the sidecar's reconciler, so it survives the cloud
 * being unreachable. When it goes stale it is shown greyed with the time it was
 * read: an operator deciding whether to run another test is better served by a
 * clearly-dated old number than by a blank, and much better than by a stale one
 * presented as current.
 */
function WalletIndicator({ status }: { status?: SidecarStatus }) {
  // No cloud configured (local-mock mode) — there is no balance to speak of.
  if (!status || status.walletBalanceCentavos === null) return null;

  const pesos = (status.walletBalanceCentavos / 100).toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });
  const price = status.walletChargePerUploadCentavos === null
    ? null
    : (status.walletChargePerUploadCentavos / 100).toLocaleString("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2,
      });

  const fetchedAt = status.walletFetchedAt ? new Date(status.walletFetchedAt) : null;
  const stale = !fetchedAt || Date.now() - fetchedAt.getTime() > WALLET_STALE_MS;

  return (
    <div className="pt-1.5 border-t border-gray-700/60 space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-400">Wallet</span>
        <span
          className={clsx(
            "font-medium",
            stale
              ? "text-gray-500"
              : status.walletNegative
                ? "text-red-400"
                : status.walletLow
                  ? "text-yellow-400"
                  : "text-gray-200"
          )}
        >
          {pesos}
        </span>
      </div>
      {price && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-400">Per accepted CEC</span>
          <span className={stale ? "text-gray-500" : "text-gray-300"}>{price}</span>
        </div>
      )}
      {fetchedAt && (
        <p className={stale ? "text-gray-500" : "text-gray-500/80"}>
          {stale ? "stale · as of " : "synced "}
          {fetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
      {/* Blocked submissions are invisible to the operator otherwise: the cloud
          holds them, and the desktop's own row just sits in "waiting". */}
      {status.walletBlockedCount > 0 && (
        <p className="text-yellow-400">
          {status.walletBlockedCount} upload{status.walletBlockedCount > 1 ? "s" : ""} held — top up
        </p>
      )}
      {status.walletNegative && !stale && (
        <p className="text-red-400">Balance overdrawn</p>
      )}
    </div>
  );
}
