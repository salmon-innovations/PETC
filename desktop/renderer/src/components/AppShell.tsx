import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useQuery } from "@tanstack/react-query";
import { sidecarClient } from "../api/sidecarClient";
import type { SidecarStatus } from "../types";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import { triggerAlert } from "../store/alertStore";
import {
  Play,
  CloudArrowUp,
  FileText,
  ChartBar,
  Gear,
  SignOut,
  CalendarBlank,
  ShieldCheck,
  Wallet,
  Warning,
  Gauge,
  Printer,
  CaretRight,
  Broadcast,
  CaretDown,
  UserCircle,
} from "@phosphor-icons/react";

const NAV = [
  { to: "/test",      label: "Run Test",    Icon: Play,          desc: "Live inspection" },
  { to: "/upload",    label: "LTMS Upload", Icon: CloudArrowUp,  desc: "Registry queue" },
  { to: "/history",   label: "History",     Icon: FileText,      desc: "Completed tests" },
  { to: "/analytics", label: "Analytics",   Icon: ChartBar,      desc: "Stats & reports" },
  { to: "/settings",  label: "Settings",    Icon: Gear,          desc: "Hardware & ports" },
];

const ROUTE_INFO: Record<string, { title: string; subtitle: string; Icon: typeof Play }> = {
  "/test": {
    title: "Emission Testing Workstation",
    subtitle: "Conduct opacity smoke density & multi-gas exhaust sampling",
    Icon: Play,
  },
  "/upload": {
    title: "LTMS Registry Upload Queue",
    subtitle: "Verify vehicle specs, encode owner details, and transmit to LTO",
    Icon: CloudArrowUp,
  },
  "/history": {
    title: "Test History & CEC Records",
    subtitle: "Filter past inspections, view digital certificates, and reprint CECs",
    Icon: FileText,
  },
  "/analytics": {
    title: "Testing Center Analytics",
    subtitle: "Operational metrics, monthly pass rates, and vehicle volume trends",
    Icon: ChartBar,
  },
  "/settings": {
    title: "Workstation Settings & Hardware",
    subtitle: "Serial COM ports, analyzer calibration, diagnostics, and center keys",
    Icon: Gear,
  },
  "/profile": {
    title: "Operator Profile & Credentials",
    subtitle: "Manage personal details, certifications, and workstation security credentials",
    Icon: UserCircle,
  },
};

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [currentDateTime, setCurrentDateTime] = useState<string>("");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const timeStr = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      setCurrentDateTime(`${dateStr} · ${timeStr}`);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: status } = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: sidecarClient.getStatus,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const { data: analyzerSettings } = useQuery({
    queryKey: ["analyzer-settings"],
    queryFn: () => sidecarClient.getAnalyzerSettings(),
    staleTime: 10_000,
  });
  const isMock = analyzerSettings?.type === "mock" || !analyzerSettings;
  const isAnalyzerReady = (status?.analyzerConnected ?? false) || isMock;

  const displayName = user?.fullName || "Mock PETC Operator";
  const displayRole = user?.role || "operator";

  const currentRouteMeta = ROUTE_INFO[location.pathname] || {
    title: "Emission Workstation",
    subtitle: "Periodic Emission Testing Center",
    Icon: Play,
  };
  const CurrentIcon = currentRouteMeta.Icon;

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans text-slate-900">
      {/* ── Sidebar ─────────────────────────────────── */}
      <motion.aside
        initial={{ x: -28, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-72 bg-[#090f1e] text-white flex flex-col flex-shrink-0 shadow-2xl border-r border-slate-800/90 relative z-20"
      >
        {/* Branding Header with comfortable top space */}
        <div className="px-6 pt-8 pb-6 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-400 flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-emerald-950/50 ring-2 ring-emerald-400/20 flex-shrink-0">
              P
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-black text-2xl tracking-tight text-white leading-none">PETC</h1>
                <span className="text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-md">
                  PRO
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400 mt-1">Emission Testing System</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-5 space-y-1.5 overflow-y-auto" aria-label="Main navigation">
          <div className="px-2 pb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              Workstation Navigation
            </span>
          </div>

          {NAV.map(({ to, label, Icon, desc }, idx) => (
            <motion.div
              key={to}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.04 * idx, duration: 0.25 }}
            >
              <NavLink
                to={to}
                className={({ isActive }) =>
                  clsx(
                    "relative flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-base font-bold transition-all group min-h-[50px] outline-none",
                    isActive
                      ? "text-white shadow-sm border border-slate-700/60"
                      : "text-slate-300 hover:text-white hover:bg-slate-800/40"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Animated Pill Background */}
                    {isActive && (
                      <motion.span
                        layoutId="active-nav-pill"
                        className="absolute inset-0 bg-gradient-to-r from-slate-800 via-slate-800/95 to-slate-800/80 rounded-2xl -z-10 shadow-md border border-slate-700/70"
                        transition={{ type: "spring", stiffness: 450, damping: 35 }}
                      />
                    )}

                    {/* Active Accent Bar on Left */}
                    {isActive && (
                      <motion.span
                        layoutId="active-accent-bar"
                        className="absolute left-0 top-2.5 bottom-2.5 w-1.5 bg-gradient-to-b from-emerald-400 to-teal-500 rounded-r-full shadow-glow-emerald"
                      />
                    )}

                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={clsx(
                          "w-9 h-9 rounded-xl flex items-center justify-center transition-colors flex-shrink-0",
                          isActive
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-slate-800/60 text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-800"
                        )}
                      >
                        <Icon size={20} weight={isActive ? "fill" : "bold"} />
                      </div>
                      <div className="text-left truncate">
                        <span className={clsx("block leading-tight", isActive ? "text-white font-extrabold" : "text-slate-300")}>
                          {label}
                        </span>
                        <span className="block text-[11px] font-medium text-slate-500 truncate mt-0.5">
                          {desc}
                        </span>
                      </div>
                    </div>

                    {/* Badge for pending uploads */}
                    {to === "/upload" && (status?.cloudOutboxPending ?? 0) > 0 && (
                      <span className="flex-shrink-0 px-2 py-0.5 text-xs font-black rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {status!.cloudOutboxPending}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </motion.div>
          ))}
        </nav>

        {/* Hardware Telemetry & Status Monitor */}
        <div className="px-4 py-4 border-t border-slate-800/80 bg-[#060b17]/70 space-y-3">
          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 space-y-2.5 shadow-inner">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Broadcast size={14} className="text-emerald-400" />
                Hardware Telemetry
              </span>
              <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck size={16} weight="fill" />
              </div>
            </div>

            <div className="space-y-2 pt-1 text-xs font-semibold">
              {/* Analyzer Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-300">
                  <Gauge size={15} className="text-slate-400" />
                  <span>Analyzer</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={clsx(
                      "h-2 w-2 rounded-full",
                      isAnalyzerReady ? "bg-emerald-400 animate-pulse shadow-glow-emerald" : "bg-red-500"
                    )}
                  />
                  <span className={isAnalyzerReady ? "text-emerald-400" : "text-red-400"}>
                    {isAnalyzerReady ? (isMock ? "Mock Ready" : "Connected") : "Offline"}
                  </span>
                </div>
              </div>

              {/* Printer Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-300">
                  <Printer size={15} className="text-slate-400" />
                  <span>Printer</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={clsx(
                      "h-2 w-2 rounded-full",
                      status?.printerStatus?.online ?? true
                        ? "bg-emerald-400 shadow-glow-emerald"
                        : "bg-red-500"
                    )}
                  />
                  <span className={status?.printerStatus?.online ?? true ? "text-emerald-400" : "text-red-400"}>
                    {status?.printerStatus?.online ?? true ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
            </div>

            <WalletIndicator status={status} />
          </div>

          {/* Cloud Outbox Alert if pending */}
          {(status?.cloudOutboxPending ?? 0) > 0 && (
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 bg-amber-500/10 px-3 py-2 rounded-xl border border-amber-500/30">
              <Warning size={16} weight="fill" className="flex-shrink-0 text-amber-400" />
              <span className="truncate">{status!.cloudOutboxPending} tests awaiting cloud upload</span>
            </div>
          )}

          {/* Sign Out Button */}
          <button
            onClick={() => {
              triggerAlert.delete("Session Ended", "You have signed out of the workstation");
              logout();
            }}
            className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-slate-700/80 bg-slate-800/40 px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-red-300 hover:bg-red-950/40 hover:border-red-800/80 transition-all cursor-pointer min-h-[42px]"
          >
            <SignOut size={16} weight="bold" />
            <span>Sign out Operator</span>
          </button>
        </div>
      </motion.aside>

      {/* ── Main viewport ─────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header Bar */}
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-8 pt-5 pb-4 flex items-center justify-between gap-6 flex-shrink-0 shadow-xs z-10">
          {/* Breadcrumb / Title Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 shadow-xs">
              <CurrentIcon size={18} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Workstation</span>
                <CaretRight size={12} className="text-slate-400" />
                <h2 className="text-sm font-black text-slate-900 tracking-tight leading-none">
                  {currentRouteMeta.title}
                </h2>
              </div>
              <p className="text-[11px] font-medium text-slate-500 mt-0.5 hidden md:block">
                {currentRouteMeta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            {/* Live Time Badge */}
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200/90 shadow-xs">
              <CalendarBlank size={16} weight="bold" className="text-slate-500" aria-hidden="true" />
              <span className="font-mono">{currentDateTime || "Loading..."}</span>
            </div>

            {/* Operator Profile — Clickable Dropdown */}
            <div className="relative flex-shrink-0" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className={clsx(
                  "flex items-center gap-3 pl-4 border-l border-slate-200 cursor-pointer rounded-xl pr-2 py-1 transition-all group outline-none",
                  profileOpen ? "bg-slate-100" : "hover:bg-slate-50"
                )}
                aria-haspopup="true"
                aria-expanded={profileOpen}
              >
                <div className="relative flex-shrink-0">
                  <div
                    className="w-10 h-10 rounded-full text-white font-extrabold flex items-center justify-center text-sm ring-2 ring-blue-100 shadow-md overflow-hidden"
                    style={{ backgroundColor: user?.avatarColor || "#2563eb" }}
                  >
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                      <span>{displayName.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-xs font-black text-slate-800 leading-tight">{displayName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                      {displayRole}
                    </span>
                  </div>
                </div>
                <CaretDown
                  size={14}
                  weight="bold"
                  className={clsx(
                    "hidden sm:block text-slate-400 transition-transform duration-200 flex-shrink-0",
                    profileOpen ? "rotate-180" : "rotate-0"
                  )}
                />
              </button>

              {/* Dropdown Menu */}
              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute right-0 top-[calc(100%+8px)] w-52 bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.12)] z-50 overflow-hidden"
                  >
                    {/* Profile Info Header */}
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
                      <p className="text-xs font-black text-slate-900 truncate">{displayName}</p>
                      <p className="text-[11px] font-medium text-slate-500 truncate">{user?.email ?? "operator@petc.local"}</p>
                    </div>

                    {/* Menu Items */}
                    <div className="p-1.5 space-y-0.5">
                      <button
                        onClick={() => { setProfileOpen(false); navigate("/profile"); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-700 transition-colors cursor-pointer group"
                      >
                        <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-100 transition-colors flex-shrink-0">
                          <UserCircle size={16} weight="fill" />
                        </div>
                        <span>Profile</span>
                      </button>

                      <button
                        onClick={() => { setProfileOpen(false); navigate("/settings"); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer group"
                      >
                        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-slate-200 transition-colors flex-shrink-0">
                          <Gear size={16} weight="fill" />
                        </div>
                        <span>Settings</span>
                      </button>
                    </div>

                    {/* Sign Out */}
                    <div className="p-1.5 pt-0 border-t border-slate-100 mt-0.5">
                      <button
                        onClick={() => {
                          setProfileOpen(false);
                          triggerAlert.delete("Session Ended", "You have signed out of the workstation");
                          logout();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 transition-colors cursor-pointer group mt-1"
                      >
                        <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center text-red-500 group-hover:bg-red-100 transition-colors flex-shrink-0">
                          <SignOut size={16} weight="bold" />
                        </div>
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Scrollable Page Outlet */}
        <main className="flex-1 overflow-y-auto bg-slate-50/70 bg-dot-pattern page-enter">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const WALLET_STALE_MS = 2 * 60 * 1000;

function WalletIndicator({ status }: { status?: SidecarStatus }) {
  if (!status || status.walletBalanceCentavos === null) return null;

  const pesos = (status.walletBalanceCentavos / 100).toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });

  const fetchedAt = status.walletFetchedAt ? new Date(status.walletFetchedAt) : null;
  const stale = !fetchedAt || Date.now() - fetchedAt.getTime() > WALLET_STALE_MS;

  return (
    <div className="pt-2 border-t border-slate-800 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-slate-400 font-semibold">
          <Wallet size={14} weight="bold" />
          Prepaid Wallet
        </span>
        <span
          className={clsx(
            "font-black font-mono tracking-tight text-xs",
            stale
              ? "text-slate-500"
              : status.walletNegative
                ? "text-red-400"
                : status.walletLow
                  ? "text-amber-400"
                  : "text-emerald-400"
          )}
        >
          {pesos}
        </span>
      </div>
      {status.walletBlockedCount > 0 && (
        <p className="text-[11px] font-medium text-amber-400">
          {status.walletBlockedCount} upload{status.walletBlockedCount > 1 ? "s" : ""} held (insufficient balance)
        </p>
      )}
    </div>
  );
}
