import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { isLtmsNonterminalState, isLtmsSuccessState, sidecarClient } from "../../api/sidecarClient";
import { TestListFilters } from "../../components/TestListFilters";
import { INSPECTION_PURPOSE_LABELS } from "../../types";
import { EMPTY_TEST_FILTERS, filterEmissionTests } from "../../utils/testFilters";
export default function HistoryPage() {
    const [filters, setFilters] = useState({ ...EMPTY_TEST_FILTERS });
    const [viewingCec, setViewingCec] = useState(null);
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
            return rows.some((t) => isLtmsNonterminalState(t.ltmsState))
                ? 10_000
                : 30_000;
        },
    });
    const filteredTests = useMemo(() => filterEmissionTests(tests, filters), [tests, filters]);
    const ltmsStates = useMemo(() => Array.from(new Set(tests.map((test) => test.ltmsState ?? "PENDING"))).sort(), [tests]);
    return (_jsxs("div", { className: "max-w-6xl mx-auto p-6 space-y-5", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Test History" }), _jsx("p", { className: "text-sm text-gray-500", children: "Search and filter completed emission tests and LTMS submissions." })] }), _jsx(TestListFilters, { filters: filters, onChange: setFilters, ltmsStates: ltmsStates, resultIncludesNotRecorded: true }), isLoading && _jsx("p", { className: "text-sm text-gray-500", children: "Loading\u2026" }), !isLoading && tests.length > 0 && (_jsxs("p", { className: "text-xs text-gray-500", children: ["Showing ", filteredTests.length, " of ", tests.length, " tests"] })), _jsxs("div", { className: "bg-white rounded-xl shadow divide-y", children: [filteredTests.map((t) => (_jsx(HistoryRow, { test: t, onViewCec: () => {
                            if (!t.submissionId)
                                return;
                            setViewingCec({
                                submissionId: t.submissionId,
                                certificateNo: t.certificateNo,
                                plateNumber: t.plateNumber,
                            });
                        } }, t.id))), !isLoading && tests.length === 0 && (_jsx("p", { className: "px-5 py-10 text-center text-sm text-gray-500", children: "No tests recorded yet." })), !isLoading && tests.length > 0 && filteredTests.length === 0 && (_jsx("p", { className: "px-5 py-10 text-center text-sm text-gray-500", children: "No tests match the selected filters." }))] }), viewingCec && (_jsx(CecViewerModal, { ...viewingCec, onClose: () => setViewingCec(null) }))] }));
}
function HistoryRow({ test: t, onViewCec, }) {
    const printMutation = useMutation({
        mutationFn: () => sidecarClient.printCec(t.submissionId, 2),
    });
    return (_jsxs("div", { className: "flex items-center justify-between px-5 py-3", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-sm text-gray-800", children: t.plateNumber }), _jsxs("p", { className: "text-xs text-gray-500", children: [t.fuelType, " \u00B7 ", INSPECTION_PURPOSE_LABELS[t.inspectionPurpose], " \u00B7 ", t.startedAt ? new Date(t.startedAt).toLocaleString() : "—"] }), t.certificateNo && (_jsxs("p", { className: "text-xs text-blue-600 mt-0.5", children: ["Cert: ", t.certificateNo] }))] }), _jsxs("div", { className: "flex items-center gap-2", children: [t.passFail !== null && (_jsx("span", { className: clsx("rounded-full px-2 py-0.5 text-xs font-medium", t.passFail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"), children: t.passFail ? "PASS" : "FAIL" })), _jsx(LtmsStateBadge, { state: t.ltmsState }), isLtmsSuccessState(t.ltmsState) && t.submissionId && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: onViewCec, className: "rounded-md border border-blue-600 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50", children: "View CEC" }), _jsx("button", { onClick: () => printMutation.mutate(), disabled: printMutation.isPending, className: "rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50", children: printMutation.isPending ? "Printing…" : printMutation.isSuccess ? "Printed ✓" : "Print CEC" })] })), isLtmsNonterminalState(t.ltmsState) && (_jsx("span", { className: "text-xs text-blue-600 animate-pulse", children: "Awaiting LTMS\u2026" }))] })] }));
}
function CecViewerModal({ submissionId, certificateNo, plateNumber, onClose, }) {
    const [pdfUrl, setPdfUrl] = useState(null);
    useEffect(() => {
        let active = true;
        sidecarClient.cecPdfUrl(submissionId).then((url) => {
            if (active)
                setPdfUrl(url);
        });
        return () => {
            active = false;
        };
    }, [submissionId]);
    useEffect(() => {
        const closeOnEscape = (event) => {
            if (event.key === "Escape")
                onClose();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6", onClick: onClose, children: _jsxs("div", { className: "flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "flex items-center justify-between border-b px-5 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-gray-800", children: "Certificate of Emission Compliance" }), _jsxs("p", { className: "text-xs text-gray-500", children: [plateNumber, certificateNo ? ` · ${certificateNo}` : ""] })] }), _jsx("button", { type: "button", onClick: onClose, className: "rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100", children: "Close" })] }), _jsx("div", { className: "min-h-0 flex-1 bg-gray-100", children: pdfUrl ? (_jsx("iframe", { src: pdfUrl, title: `CEC for ${plateNumber}`, className: "h-full w-full border-0" })) : (_jsx("div", { className: "flex h-full items-center justify-center text-sm text-gray-500", children: "Loading CEC\u2026" })) })] }) }));
}
function LtmsStateBadge({ state }) {
    const label = state ?? "pending LTMS";
    const cls = clsx("rounded-full px-2 py-0.5 text-xs", isLtmsSuccessState(state)
        ? "bg-blue-100 text-blue-700"
        : state === "FAILED_EVALUATION" || state === "ACTION_REQUIRED"
            || state === "AUTH_BLOCKED" || state === "REJECTED" || state === "DEAD"
            ? "bg-red-100 text-red-600"
            : state === "RECONCILING"
                ? "bg-purple-100 text-purple-700"
                : state === "DEFERRED" || state === "BLOCKED"
                    ? "bg-amber-100 text-amber-700"
                    : isLtmsNonterminalState(state)
                        ? "bg-blue-50 text-blue-500"
                        : "bg-yellow-100 text-yellow-700");
    return _jsx("span", { className: cls, children: label });
}
