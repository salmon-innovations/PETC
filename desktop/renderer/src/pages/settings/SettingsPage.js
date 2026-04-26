import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { sidecarClient } from "../../api/sidecarClient";
export default function SettingsPage() {
    const { data: status } = useQuery({
        queryKey: ["sidecar-status"],
        queryFn: sidecarClient.getStatus,
    });
    return (_jsxs("div", { className: "max-w-xl mx-auto p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Settings" }), _jsxs("section", { className: "bg-white rounded-xl shadow divide-y", children: [_jsx(Row, { label: "Agent Version", value: status?.agentVersion ?? "—" }), _jsx(Row, { label: "Analyzer", value: status?.analyzerConnected ? "Connected" : "Offline", ok: status?.analyzerConnected }), _jsx(Row, { label: "Printer", value: status?.printerStatus.online ? "Online" : "Offline", ok: status?.printerStatus.online }), _jsx(Row, { label: "Paper", value: status?.printerStatus.paper_ok ? "OK" : "Low / empty", ok: status?.printerStatus.paper_ok }), _jsx(Row, { label: "Cloud sync queue", value: `${status?.cloudOutboxPending ?? "—"} pending` })] }), _jsxs("section", { className: "bg-white rounded-xl shadow p-5 space-y-2", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Data Location" }), _jsx(DataPath, {})] })] }));
}
function Row({ label, value, ok }) {
    return (_jsxs("div", { className: "flex items-center justify-between px-5 py-3 text-sm", children: [_jsx("span", { className: "text-gray-600", children: label }), _jsx("span", { className: ok === false ? "text-red-600 font-medium" : ok === true ? "text-green-700 font-medium" : "text-gray-800", children: value })] }));
}
function DataPath() {
    const { data: path } = useQuery({
        queryKey: ["userData"],
        queryFn: () => window.petcBridge.getUserDataPath(),
    });
    return (_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("code", { className: "text-xs text-gray-500 truncate", children: path ?? "…" }), _jsx("button", { onClick: () => path && window.petcBridge.openPath(path), className: "flex-shrink-0 rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50", children: "Open" })] }));
}
