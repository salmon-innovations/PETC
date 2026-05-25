import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, } from "recharts";
import { api } from "../../api/webClient";
export default function CrossCenterDashboard() {
    const { data: centers = [] } = useQuery({
        queryKey: ["analytics", "centers"],
        queryFn: () => api.get("/analytics/centers").then((r) => r.data),
        staleTime: 60_000,
    });
    const { data: daily = [] } = useQuery({
        queryKey: ["analytics", "cross-daily"],
        queryFn: () => api.get("/analytics/daily-rollup?days=14").then((r) => r.data),
        staleTime: 60_000,
    });
    const { data: recentEvents = [] } = useQuery({
        queryKey: ["analytics", "recent-events"],
        queryFn: () => api.get("/analytics/recent-events?limit=12").then((r) => r.data),
        staleTime: 30_000,
    });
    const totalTests = centers.reduce((s, c) => s + c.testsThisMonth, 0);
    const totalMirrored = centers.reduce((s, c) => s + c.totalTests, 0);
    const avgPass = centers.length
        ? centers.reduce((s, c) => s + c.passRate, 0) / centers.length
        : 0;
    const totalPending = centers.reduce((s, c) => s + c.pendingLtms, 0);
    return (_jsxs("div", { className: "p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Cross-Center Analytics" }), _jsx("div", { className: "grid grid-cols-4 gap-4", children: [
                    { label: "Tests This Month", value: totalTests },
                    { label: "Mirrored Tests", value: totalMirrored },
                    { label: "Avg Pass Rate", value: `${(avgPass * 100).toFixed(1)}%` },
                    { label: "Pending LTMS", value: totalPending },
                ].map(({ label, value }) => (_jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("p", { className: "text-xs text-gray-500", children: label }), _jsx("p", { className: "text-3xl font-bold text-gray-800 mt-1", children: value })] }, label))) }), _jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("h2", { className: "text-sm font-semibold text-gray-700 mb-4", children: "Tests by Center (This Month)" }), _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(BarChart, { data: centers, layout: "vertical", children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", horizontal: false }), _jsx(XAxis, { type: "number", tick: { fontSize: 11 }, allowDecimals: false }), _jsx(YAxis, { type: "category", dataKey: "centerName", tick: { fontSize: 11 }, width: 120 }), _jsx(Tooltip, {}), _jsx(Bar, { dataKey: "testsThisMonth", name: "Tests", fill: "#3b82f6", radius: [0, 3, 3, 0] })] }) })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("h2", { className: "text-sm font-semibold text-gray-700 mb-4", children: "Daily Tests \u2014 All Centers (14 days)" }), _jsx(ResponsiveContainer, { width: "100%", height: 200, children: _jsxs(LineChart, { data: daily, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", vertical: false }), _jsx(XAxis, { dataKey: "date", tick: { fontSize: 11 } }), _jsx(YAxis, { tick: { fontSize: 11 }, allowDecimals: false }), _jsx(Tooltip, {}), _jsx(Legend, {}), _jsx(Line, { type: "monotone", dataKey: "total", name: "Total", stroke: "#6b7280", dot: false }), _jsx(Line, { type: "monotone", dataKey: "passed", name: "Passed", stroke: "#22c55e", dot: false })] }) })] }), _jsx("div", { className: "bg-white rounded-xl shadow overflow-hidden", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide", children: _jsx("tr", { children: ["Center", "Total", "Tests (month)", "Pass Rate", "Accepted", "Rejected", "Pending LTMS", "Last Sync"].map((h) => (_jsx("th", { className: "px-5 py-3 text-left font-semibold", children: h }, h))) }) }), _jsx("tbody", { className: "divide-y", children: centers.map((c) => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-5 py-3 font-medium", children: c.centerName }), _jsx("td", { className: "px-5 py-3", children: c.totalTests }), _jsx("td", { className: "px-5 py-3", children: c.testsThisMonth }), _jsxs("td", { className: "px-5 py-3", children: [(c.passRate * 100).toFixed(1), "%"] }), _jsx("td", { className: "px-5 py-3", children: c.acceptedLtms }), _jsx("td", { className: "px-5 py-3", children: c.rejectedLtms }), _jsx("td", { className: "px-5 py-3", children: c.pendingLtms }), _jsx("td", { className: "px-5 py-3 text-gray-500", children: c.lastSync ? new Date(c.lastSync).toLocaleString() : "—" })] }, c.centerName))) })] }) }), _jsxs("div", { className: "bg-white rounded-xl shadow overflow-hidden", children: [_jsx("div", { className: "px-5 py-4 border-b", children: _jsx("h2", { className: "text-sm font-semibold text-gray-700", children: "Recent Mirror Events" }) }), _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide", children: _jsx("tr", { children: ["Time", "Center", "Event", "Entity"].map((h) => (_jsx("th", { className: "px-5 py-3 text-left font-semibold", children: h }, h))) }) }), _jsxs("tbody", { className: "divide-y", children: [recentEvents.map((event) => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-5 py-3 text-gray-500", children: new Date(event.receivedAt).toLocaleString() }), _jsx("td", { className: "px-5 py-3 font-medium", children: event.centerName }), _jsx("td", { className: "px-5 py-3", children: event.entityType }), _jsx("td", { className: "px-5 py-3 font-mono text-xs text-gray-500", children: event.entityId })] }, `${event.receivedAt}-${event.entityType}-${event.entityId}`))), recentEvents.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 4, className: "px-5 py-8 text-center text-gray-500", children: "No mirror events yet." }) }))] })] })] })] }));
}
