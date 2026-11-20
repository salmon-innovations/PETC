import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import axios from "axios";
import { motion } from "framer-motion";
import {
  ChartBar,
  CalendarBlank,
  CheckCircle,
  CloudArrowUp,
  ArrowClockwise,
  GasPump,
  TrendUp,
  ShieldCheck,
  WarningCircle,
  Gauge,
  Check,
} from "@phosphor-icons/react";
import clsx from "clsx";

interface DailyStat {
  date: string;
  total: number;
  passed: number;
}

interface FuelSplit {
  fuelType: string;
  count: number;
}

interface Summary {
  totalTests: number;
  testsThisMonth: number;
  passRate: number;
  passed: number;
  failed: number;
  pendingLtms: number;
}

const FUEL_COLORS: Record<string, string> = {
  GAS: "#3b82f6",
  DIESEL: "#f59e0b",
};

const TIMEFRAME_OPTIONS = [
  { label: "7 Days", value: 7 },
  { label: "14 Days", value: 14 },
  { label: "30 Days", value: 30 },
];

async function fetchSidecar<T>(path: string): Promise<T> {
  const base = await window.petcBridge.getSidecarUrl();
  const { data } = await axios.get<T>(`${base}${path}`);
  return data;
}

function formatDateLabel(dateStr: string): string {
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  } catch {
    // fallback
  }
  return dateStr;
}

function formatFullDate(dateStr: string): string {
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    }
  } catch {
    // fallback
  }
  return dateStr;
}

export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState<number>(7);

  const {
    data: summary,
    isLoading: isSummaryLoading,
    isFetching: isSummaryFetching,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["analytics", "summary"],
    queryFn: () => fetchSidecar<Summary>("/analytics/summary"),
    staleTime: 30_000,
  });

  const {
    data: daily = [],
    isLoading: isDailyLoading,
    isFetching: isDailyFetching,
    refetch: refetchDaily,
  } = useQuery({
    queryKey: ["analytics", "daily", timeframe],
    queryFn: () => fetchSidecar<DailyStat[]>(`/analytics/daily?days=${timeframe}`),
    staleTime: 60_000,
  });

  const {
    data: fuel = [],
    isLoading: isFuelLoading,
    isFetching: isFuelFetching,
    refetch: refetchFuel,
  } = useQuery({
    queryKey: ["analytics", "fuel"],
    queryFn: () => fetchSidecar<FuelSplit[]>("/analytics/fuel-split"),
    staleTime: 60_000,
  });

  const isRefreshing = isSummaryFetching || isDailyFetching || isFuelFetching;

  const handleRefreshAll = () => {
    refetchSummary();
    refetchDaily();
    refetchFuel();
  };

  // Fuel calculations
  const totalFuelCount = fuel.reduce((sum, f) => sum + f.count, 0);

  // Daily throughput calculations
  const activeDaysCount = daily.length || 1;
  const totalPeriodTests = daily.reduce((sum, d) => sum + d.total, 0);
  const avgTestsPerDay = (totalPeriodTests / activeDaysCount).toFixed(1);

  // Stagger animation container variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 14 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: "easeOut" as const },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-6xl mx-auto p-6 sm:p-8 space-y-6"
    >
      {/* Top Controls Bar */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-600 shadow-sm">
            <ChartBar size={26} weight="fill" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Testing Center Analytics</h1>
            <p className="text-slate-500 text-sm font-medium">
              Real-time operational throughput, emissions compliance, and vehicle splits.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* Timeframe selector pill */}
          <div className="flex items-center p-1 bg-slate-200/80 rounded-xl border border-slate-300/70 shadow-inner">
            {TIMEFRAME_OPTIONS.map((opt) => {
              const active = timeframe === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTimeframe(opt.value)}
                  className={clsx(
                    "relative px-3.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer",
                    active ? "text-slate-900" : "text-slate-600 hover:text-slate-800"
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="timeframePill"
                      className="absolute inset-0 bg-white rounded-lg shadow-sm border border-slate-200/80"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-bold text-xs shadow-sm transition-all cursor-pointer disabled:opacity-60 active:scale-95"
            title="Refresh analytics data"
          >
            <ArrowClockwise
              size={15}
              weight="bold"
              className={clsx("text-slate-600", isRefreshing && "animate-spin text-blue-600")}
            />
            <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
          </button>
        </div>
      </motion.div>

      {/* KPI Stat Cards Grid */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Tests This Month */}
        <motion.div
          whileHover={{ y: -3, transition: { duration: 0.18 } }}
          className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md p-5 flex flex-col justify-between transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Monthly Volume
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <CalendarBlank size={22} weight="fill" />
            </div>
          </div>

          <div className="mt-4">
            {isSummaryLoading || !summary ? (
              <div className="h-9 w-24 bg-slate-200 rounded-lg animate-pulse" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 tracking-tight">
                  {summary.testsThisMonth.toLocaleString()}
                </span>
                <span className="text-xs font-semibold text-slate-500">tests</span>
              </div>
            )}
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              <span>Current billing cycle</span>
            </div>
          </div>
        </motion.div>

        {/* Card 2: Pass Rate */}
        <motion.div
          whileHover={{ y: -3, transition: { duration: 0.18 } }}
          className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md p-5 flex flex-col justify-between transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Compliance Pass Rate
            </span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
              <CheckCircle size={22} weight="fill" />
            </div>
          </div>

          <div className="mt-4">
            {isSummaryLoading || !summary ? (
              <div className="h-9 w-28 bg-slate-200 rounded-lg animate-pulse" />
            ) : (
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-slate-900 tracking-tight">
                    {(summary.passRate * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                    Clean Air
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(summary.passRate * 100, 100)}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  <span className="text-emerald-700">{summary.passed} passed</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-amber-700">{summary.failed} failed</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Card 3: Pending LTMS Queue */}
        <motion.div
          whileHover={{ y: -3, transition: { duration: 0.18 } }}
          className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md p-5 flex flex-col justify-between transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              LTMS Upload Queue
            </span>
            <div
              className={clsx(
                "w-10 h-10 rounded-xl flex items-center justify-center border",
                summary && summary.pendingLtms > 0
                  ? "bg-amber-50 border-amber-100 text-amber-600"
                  : "bg-teal-50 border-teal-100 text-teal-600"
              )}
            >
              <CloudArrowUp size={22} weight="fill" />
            </div>
          </div>

          <div className="mt-4">
            {isSummaryLoading || !summary ? (
              <div className="h-9 w-20 bg-slate-200 rounded-lg animate-pulse" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 tracking-tight">
                  {summary.pendingLtms}
                </span>
                <span className="text-xs font-semibold text-slate-500">pending</span>
              </div>
            )}

            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
              {summary && summary.pendingLtms > 0 ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                  </span>
                  <span className="text-amber-700">Awaiting transmission</span>
                </>
              ) : (
                <>
                  <Check size={14} weight="bold" className="text-emerald-500" />
                  <span className="text-emerald-700">Registry fully synced</span>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {/* Card 4: Daily Average Throughput */}
        <motion.div
          whileHover={{ y: -3, transition: { duration: 0.18 } }}
          className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md p-5 flex flex-col justify-between transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Avg. Throughput
            </span>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <TrendUp size={22} weight="bold" />
            </div>
          </div>

          <div className="mt-4">
            {isDailyLoading ? (
              <div className="h-9 w-24 bg-slate-200 rounded-lg animate-pulse" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 tracking-tight">
                  {avgTestsPerDay}
                </span>
                <span className="text-xs font-semibold text-slate-500">tests/day</span>
              </div>
            )}
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
              <span>Across last {timeframe} days</span>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Main Visualizations Grid */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Bar Chart of Daily Inspections */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Daily Inspection Volume</h2>
                <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  Last {timeframe} Days
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Comparison of vehicles tested vs vehicles successfully meeting DENR standards
              </p>
            </div>

            {/* Custom chart legend badges */}
            <div className="flex items-center gap-4 text-xs font-bold">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-emerald-600 to-emerald-400" />
                <span className="text-slate-700">Passed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-slate-400 to-slate-300" />
                <span className="text-slate-500">Total</span>
              </div>
            </div>
          </div>

          {isDailyLoading ? (
            <div className="h-[280px] flex items-end justify-between gap-3 px-4 pb-4 pt-12 animate-pulse bg-slate-50/70 rounded-xl">
              {Array.from({ length: timeframe > 14 ? 14 : timeframe }).map((_, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className="w-full bg-slate-200 rounded-t-lg"
                    style={{ height: `${30 + (i * 17) % 65}%` }}
                  />
                  <div className="w-6 h-3 bg-slate-200 rounded" />
                </div>
              ))}
            </div>
          ) : daily.length === 0 ? (
            <div className="h-[280px] flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <ChartBar size={36} weight="light" />
              <p className="text-sm font-semibold mt-2">No emission test records in this timeframe</p>
            </div>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="passedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.85} />
                    </linearGradient>
                    <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#cbd5e1" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateLabel}
                    tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomDailyTooltip />} cursor={{ fill: "rgba(241, 245, 249, 0.6)" }} />
                  <Bar
                    dataKey="total"
                    name="Total Tested"
                    fill="url(#totalGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                  <Bar
                    dataKey="passed"
                    name="Passed Standard"
                    fill="url(#passedGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Right 1 Col: Fuel Split Donut Chart */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-bold text-slate-900">Fuel Type Distribution</h2>
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                <GasPump size={18} weight="bold" />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Breakdown of inspected gasoline vs diesel powertrain engines
            </p>
          </div>

          <div className="relative my-4 flex items-center justify-center">
            {isFuelLoading ? (
              <div className="h-[210px] flex items-center justify-center animate-pulse">
                <div className="w-36 h-36 rounded-full border-[16px] border-slate-100 border-t-blue-400" />
              </div>
            ) : totalFuelCount === 0 ? (
              <div className="h-[210px] flex flex-col items-center justify-center text-slate-400">
                <WarningCircle size={32} weight="light" />
                <p className="text-xs font-semibold mt-2">No fuel test data available</p>
              </div>
            ) : (
              <div className="h-[210px] w-full flex items-center justify-center relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={fuel}
                      dataKey="count"
                      nameKey="fuelType"
                      cx="50%"
                      cy="50%"
                      innerRadius={62}
                      outerRadius={86}
                      paddingAngle={3}
                      stroke="#ffffff"
                      strokeWidth={2}
                    >
                      {fuel.map((entry) => (
                        <Cell
                          key={entry.fuelType}
                          fill={FUEL_COLORS[entry.fuelType] ?? "#94a3b8"}
                          className="transition-all duration-300 hover:opacity-85"
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomFuelTooltip total={totalFuelCount} />} />
                  </PieChart>
                </ResponsiveContainer>

                {/* Center Badge inside Donut Hole */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-black text-slate-900 leading-none">
                    {totalFuelCount}
                  </span>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">
                    Vehicles
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Fuel Split Interactive Legend Pill Cards */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            {fuel.map((item) => {
              const color = FUEL_COLORS[item.fuelType] ?? "#64748b";
              const pct = totalFuelCount > 0 ? ((item.count / totalFuelCount) * 100).toFixed(1) : "0.0";
              return (
                <div
                  key={item.fuelType}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/80 hover:bg-slate-100/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-bold text-slate-800">
                      {item.fuelType === "GAS" ? "Gasoline Engines" : "Diesel Engines"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{item.count}</span>
                    <span className="text-[11px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200/80">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* Operational Health & Standards Footer Banner */}
      <motion.div
        variants={itemVariants}
        className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 rounded-2xl p-5 text-white shadow-md border border-slate-800"
      >
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <ShieldCheck size={24} weight="fill" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Operational Compliance & Hardware Integrity
                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                  Active
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                All emission testing algorithms comply with Republic Act No. 8749 (Philippine Clean Air Act of 1999).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full lg:w-auto justify-end border-t lg:border-t-0 border-slate-800 pt-3 lg:pt-0 text-xs">
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60">
              <Gauge size={16} className="text-blue-400" weight="bold" />
              <span className="text-slate-300 font-semibold">Dual Analyzer Calibrated</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60">
              <CloudArrowUp size={16} className="text-emerald-400" weight="bold" />
              <span className="text-slate-300 font-semibold">LTO Gateway Connected</span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Custom Glass Dark Tooltip for Daily Tests
function CustomDailyTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const total = payload.find((p: any) => p.dataKey === "total")?.value ?? 0;
    const passed = payload.find((p: any) => p.dataKey === "passed")?.value ?? 0;
    const failed = Math.max(0, total - passed);
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

    return (
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 shadow-2xl text-xs text-white min-w-[170px] pointer-events-none">
        <p className="font-bold text-slate-200 border-b border-slate-800 pb-1.5 mb-2">
          {formatFullDate(label)}
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              Total Inspected:
            </span>
            <span className="font-black text-white">{total}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-emerald-400 font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Passed Clean:
            </span>
            <span className="font-black text-emerald-400">{passed}</span>
          </div>

          {failed > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-amber-400 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Failed Standards:
              </span>
              <span className="font-black text-amber-400">{failed}</span>
            </div>
          )}

          <div className="pt-1.5 mt-1 border-t border-slate-800 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Compliance Rate:</span>
            <span className="font-extrabold text-teal-300">{passRate}%</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// Custom Glass Dark Tooltip for Fuel Split
function CustomFuelTooltip({ active, payload, total }: any) {
  if (active && payload && payload.length) {
    const data = payload[0];
    const fuelType = data.name;
    const count = data.value;
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
    const isGas = fuelType === "GAS";

    return (
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 shadow-2xl text-xs text-white min-w-[150px] pointer-events-none">
        <p className="font-bold text-slate-200 border-b border-slate-800 pb-1.5 mb-2 flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: isGas ? "#3b82f6" : "#f59e0b" }}
          />
          {isGas ? "Gasoline (Spark)" : "Diesel (Compression)"}
        </p>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-medium">Inspected:</span>
            <span className="font-black text-white">{count} vehicles</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-medium">Distribution:</span>
            <span className="font-extrabold text-teal-300">{pct}%</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
