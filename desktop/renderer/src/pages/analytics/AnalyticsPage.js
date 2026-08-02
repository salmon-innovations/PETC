import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, } from "recharts";
import axios from "axios";
const FUEL_COLORS = { GAS: "#3b82f6", DIESEL: "#f59e0b" };
async function fetchSidecar(path) {
    const base = await window.petcBridge.getSidecarUrl();
    const { data } = await axios.get(`${base}${path}`);
    return data;
}
export default function AnalyticsPage() {
    const { data: summary } = useQuery({ queryKey: ["analytics", "summary"], queryFn: () => fetchSidecar("/analytics/summary"), staleTime: 30_000 });
    const { data: daily = [] } = useQuery({ queryKey: ["analytics", "daily"], queryFn: () => fetchSidecar("/analytics/daily?days=7"), staleTime: 60_000 });
    const { data: fuel = [] } = useQuery({ queryKey: ["analytics", "fuel"], queryFn: () => fetchSidecar("/analytics/fuel-split"), staleTime: 60_000 });
    return (_jsxs("div", { className: "p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Analytics" }), summary && (_jsx("div", { className: "grid grid-cols-3 gap-4", children: [
                    { label: "Tests This Month", value: summary.testsThisMonth },
                    { label: "Pass Rate", value: `${(summary.passRate * 100).toFixed(1)}%` },
                    { label: "Pending LTMS", value: summary.pendingLtms },
                ].map(({ label, value }) => (_jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("p", { className: "text-xs text-gray-500", children: label }), _jsx("p", { className: "text-3xl font-bold text-gray-800 mt-1", children: value })] }, label))) })), _jsxs("div", { className: "grid grid-cols-3 gap-6", children: [_jsxs("div", { className: "col-span-2 bg-white rounded-xl shadow p-5", children: [_jsx("h2", { className: "text-sm font-semibold text-gray-700 mb-3", children: "Tests \u2014 Last 7 Days" }), _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(BarChart, { data: daily, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", vertical: false }), _jsx(XAxis, { dataKey: "date", tick: { fontSize: 11 } }), _jsx(YAxis, { tick: { fontSize: 11 }, allowDecimals: false }), _jsx(Tooltip, {}), _jsx(Bar, { dataKey: "passed", name: "Passed", fill: "#22c55e", radius: [3, 3, 0, 0] }), _jsx(Bar, { dataKey: "total", name: "Total", fill: "#e5e7eb", radius: [3, 3, 0, 0] })] }) })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("h2", { className: "text-sm font-semibold text-gray-700 mb-3", children: "Fuel Split" }), _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(PieChart, { children: [_jsx(Pie, { data: fuel, dataKey: "count", nameKey: "fuelType", cx: "50%", cy: "50%", outerRadius: 75, label: ({ fuelType, percent }) => `${fuelType} ${((percent ?? 0) * 100).toFixed(0)}%`, children: fuel.map((e) => _jsx(Cell, { fill: FUEL_COLORS[e.fuelType] ?? "#6b7280" }, e.fuelType)) }), _jsx(Legend, {})] }) })] })] })] }));
}
