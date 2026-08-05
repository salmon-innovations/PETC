import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import clsx from "clsx";
import { sidecarClient } from "../../api/sidecarClient";
export default function HistoryPage() {
    const { data: tests = [], isLoading } = useQuery({
        queryKey: ["tests", "all"],
        queryFn: async () => {
            const base = await window.petcBridge.getSidecarUrl();
            const { data } = await axios.get(`${base}/tests?limit=100`);
            return data;
        },
        // Poll faster while any row is still waiting for LTMS
        refetchInterval: (query) => {
            const rows = query.state.data ?? [];
            return rows.some((t) => t.ltmsState === "WAITING_FOR_LTMS" || t.ltmsState === "PENDING")
                ? 10_000
                : 30_000;
        },
    });
    return (_jsxs("div", { className: "max-w-3xl mx-auto p-6 space-y-5", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Test History" }), isLoading && _jsx("p", { className: "text-sm text-gray-500", children: "Loading\u2026" }), _jsxs("div", { className: "bg-white rounded-xl shadow divide-y", children: [tests.map((t) => (_jsx(HistoryRow, { test: t }, t.id))), !isLoading && tests.length === 0 && (_jsx("p", { className: "px-5 py-10 text-center text-sm text-gray-500", children: "No tests recorded yet." }))] })] }));
}
function HistoryRow({ test: t }) {
    const printMutation = useMutation({
        mutationFn: () => sidecarClient.printCec(t.submissionId, 2),
    });
    return (_jsxs("div", { className: "flex items-center justify-between px-5 py-3", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-sm text-gray-800", children: t.plateNumber }), _jsxs("p", { className: "text-xs text-gray-500", children: [t.fuelType, " \u00B7 ", t.startedAt ? new Date(t.startedAt).toLocaleString() : "—"] }), t.certificateNo && (_jsxs("p", { className: "text-xs text-blue-600 mt-0.5", children: ["Cert: ", t.certificateNo] }))] }), _jsxs("div", { className: "flex items-center gap-2", children: [t.passFail !== null && (_jsx("span", { className: clsx("rounded-full px-2 py-0.5 text-xs font-medium", t.passFail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"), children: t.passFail ? "PASS" : "FAIL" })), _jsx(LtmsStateBadge, { state: t.ltmsState }), t.ltmsState === "ACCEPTED" && t.submissionId && (_jsx("button", { onClick: () => printMutation.mutate(), disabled: printMutation.isPending, className: "rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50", children: printMutation.isPending ? "Printing…" : printMutation.isSuccess ? "Printed ✓" : "Print CEC" })), t.ltmsState === "WAITING_FOR_LTMS" && (_jsx("span", { className: "text-xs text-blue-600 animate-pulse", children: "Awaiting LTMS\u2026" }))] })] }));
}
function LtmsStateBadge({ state }) {
    const label = state ?? "pending LTMS";
    const cls = clsx("rounded-full px-2 py-0.5 text-xs", state === "ACCEPTED"
        ? "bg-blue-100 text-blue-700"
        : state === "REJECTED"
            ? "bg-red-100 text-red-600"
            : state === "WAITING_FOR_LTMS"
                ? "bg-blue-50 text-blue-500"
                : "bg-yellow-100 text-yellow-700");
    return _jsx("span", { className: cls, children: label });
}
