import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import clsx from "clsx";
export default function HistoryPage() {
    const { data: tests = [], isLoading } = useQuery({
        queryKey: ["tests", "all"],
        queryFn: async () => {
            const base = await window.petcBridge.getSidecarUrl();
            const { data } = await axios.get(`${base}/tests?limit=100`);
            return data;
        },
        staleTime: 30_000,
    });
    return (_jsxs("div", { className: "max-w-3xl mx-auto p-6 space-y-5", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Test History" }), isLoading && _jsx("p", { className: "text-sm text-gray-500", children: "Loading\u2026" }), _jsxs("div", { className: "bg-white rounded-xl shadow divide-y", children: [tests.map((t) => (_jsxs("div", { className: "flex items-center justify-between px-5 py-3", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-sm text-gray-800", children: t.plateNumber }), _jsxs("p", { className: "text-xs text-gray-500", children: [t.fuelType, " \u00B7 ", t.startedAt ? new Date(t.startedAt).toLocaleString() : "—"] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [t.passFail !== null && (_jsx("span", { className: clsx("rounded-full px-2 py-0.5 text-xs font-medium", t.passFail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"), children: t.passFail ? "PASS" : "FAIL" })), _jsx("span", { className: clsx("rounded-full px-2 py-0.5 text-xs", t.ltmsState === "ACCEPTED"
                                            ? "bg-blue-100 text-blue-700"
                                            : t.ltmsState === "REJECTED"
                                                ? "bg-red-100 text-red-600"
                                                : "bg-yellow-100 text-yellow-700"), children: t.ltmsState ?? "pending LTMS" })] })] }, t.id))), !isLoading && tests.length === 0 && (_jsx("p", { className: "px-5 py-10 text-center text-sm text-gray-500", children: "No tests recorded yet." }))] })] }));
}
