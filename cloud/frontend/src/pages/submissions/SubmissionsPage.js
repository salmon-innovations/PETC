import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { api } from "../../api/webClient";
import { formatCentavos, formatDateTime } from "../../utils/money";
const STATES = ["", "PENDING", "IN_FLIGHT", "ACCEPTED", "REJECTED", "BLOCKED", "DEAD"];
const STATE_STYLES = {
    ACCEPTED: "bg-green-100 text-green-700",
    PENDING: "bg-blue-100 text-blue-700",
    IN_FLIGHT: "bg-blue-100 text-blue-700",
    BLOCKED: "bg-amber-100 text-amber-800",
    REJECTED: "bg-red-100 text-red-700",
    DEAD: "bg-gray-200 text-gray-700",
};
function StateBadge({ state }) {
    return (_jsx("span", { className: clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATE_STYLES[state] ?? "bg-gray-100 text-gray-600"), children: state }));
}
function DetailPanel({ id, onClose }) {
    const { data } = useQuery({
        queryKey: ["submission", id],
        queryFn: () => api.get(`/admin/submissions/${id}`).then((r) => r.data),
    });
    return (_jsx("div", { className: "fixed inset-0 bg-black/30 flex justify-end z-50", onClick: onClose, children: _jsxs("div", { className: "bg-white w-full max-w-xl h-full overflow-y-auto p-6 space-y-5", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-bold text-gray-800", children: data?.test_id ?? "…" }), _jsx("p", { className: "text-xs text-gray-500", children: data?.center_name })] }), _jsx("button", { onClick: onClose, className: "text-xs text-gray-500 underline", children: "Close" })] }), data && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-2 gap-3 text-sm", children: [_jsx(Field, { label: "State", children: _jsx(StateBadge, { state: data.state }) }), _jsx(Field, { label: "Attempts", children: data.attempts }), _jsx(Field, { label: "Certificate", children: data.certificate_no ?? "—" }), _jsx(Field, { label: "OR No.", children: data.or_no ?? "—" }), _jsx(Field, { label: "Created", children: formatDateTime(data.created_at) }), _jsx(Field, { label: "Accepted", children: formatDateTime(data.accepted_at) }), _jsx(Field, { label: "Quoted price", children: formatCentavos(data.charge_snapshot_centavos) }), _jsx(Field, { label: "Price quoted", children: formatDateTime(data.price_snapshotted_at) }), _jsx(Field, { label: "Valid from", children: data.valid_from ?? "—" }), _jsx(Field, { label: "Valid until", children: data.valid_until ?? "—" })] }), data.state === "BLOCKED" && (_jsxs("div", { className: "rounded-lg bg-amber-50 border border-amber-300 p-3 text-xs text-amber-800", children: ["Held since ", formatDateTime(data.blocked_at), " \u2014 the center's wallet cannot cover this filing. It dispatches automatically on top-up, or on grace expiry."] })), data.grace_released_at && (_jsxs("div", { className: "rounded-lg bg-amber-50 border border-amber-300 p-3 text-xs text-amber-800", children: ["Force-released on grace at ", formatDateTime(data.grace_released_at), " \u2014 filed despite insufficient funds so the center stayed compliant."] })), data.rejection_reason && (_jsxs("div", { className: "rounded-lg bg-red-50 border border-red-300 p-3 text-xs text-red-800", children: [_jsx("span", { className: "font-semibold", children: "Rejected:" }), " ", data.rejection_reason] })), _jsxs("div", { children: [_jsx("h3", { className: "text-xs font-semibold text-gray-600 uppercase mb-2", children: "Wallet activity" }), data.ledger.length === 0 ? (_jsx("p", { className: "text-xs text-gray-400", children: "No charges \u2014 this submission was never accepted." })) : (_jsx("table", { className: "w-full text-xs", children: _jsx("tbody", { className: "divide-y", children: data.ledger.map((l, i) => (_jsxs("tr", { children: [_jsx("td", { className: "py-1.5", children: l.entry_type }), _jsxs("td", { className: "py-1.5 text-gray-500", children: ["#", l.acceptance_seq] }), _jsx("td", { className: "py-1.5 text-right font-medium text-red-600", children: formatCentavos(l.amount_centavos) }), _jsx("td", { className: "py-1.5 text-right text-gray-500", children: formatCentavos(l.balance_after) })] }, i))) }) }))] }), _jsxs("div", { children: [_jsx("h3", { className: "text-xs font-semibold text-gray-600 uppercase mb-2", children: "Payload" }), _jsx("pre", { className: "bg-gray-50 rounded-lg p-3 text-xs overflow-x-auto max-h-72", children: JSON.stringify(JSON.parse(data.payload), null, 2) })] })] }))] }) }));
}
function Field({ label, children }) {
    return (_jsxs("div", { children: [_jsx("p", { className: "text-xs text-gray-500", children: label }), _jsx("p", { className: "font-medium text-gray-800", children: children })] }));
}
export default function SubmissionsPage() {
    const [params, setParams] = useSearchParams();
    const [selected, setSelected] = useState(null);
    const state = params.get("state") ?? "";
    const centerId = params.get("centerId") ?? "";
    const { data: submissions = [] } = useQuery({
        queryKey: ["submissions", state, centerId],
        queryFn: () => {
            const q = new URLSearchParams();
            if (state)
                q.set("state", state);
            if (centerId)
                q.set("centerId", centerId);
            q.set("limit", "100");
            return api.get(`/admin/submissions?${q}`).then((r) => r.data);
        },
        refetchInterval: 15_000,
    });
    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        if (value)
            next.set(key, value);
        else
            next.delete(key);
        setParams(next);
    };
    return (_jsxs("div", { className: "max-w-6xl mx-auto p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Submissions" }), _jsxs("div", { className: "bg-white rounded-xl shadow p-4 flex gap-3 items-end", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "State" }), _jsx("select", { value: state, onChange: (e) => setFilter("state", e.target.value), className: "rounded-lg border border-gray-300 px-3 py-2 text-sm", children: STATES.map((s) => _jsx("option", { value: s, children: s || "All states" }, s)) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Center slug" }), _jsx("input", { value: centerId, onChange: (e) => setFilter("centerId", e.target.value), placeholder: "makati-etc", className: "rounded-lg border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("span", { className: "ml-auto text-xs text-gray-500", children: [submissions.length, " shown"] })] }), _jsx("div", { className: "bg-white rounded-xl shadow overflow-hidden", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide", children: _jsx("tr", { children: ["Test", "Center", "State", "Certificate", "Created", ""].map((h) => (_jsx("th", { className: "px-5 py-3 text-left font-semibold", children: h }, h))) }) }), _jsxs("tbody", { className: "divide-y", children: [submissions.map((s) => (_jsxs("tr", { className: clsx("hover:bg-gray-50", s.state === "BLOCKED" && "bg-amber-50/40"), children: [_jsx("td", { className: "px-5 py-3 font-medium", children: s.test_id }), _jsx("td", { className: "px-5 py-3 text-gray-600", children: s.center_name }), _jsxs("td", { className: "px-5 py-3", children: [_jsx(StateBadge, { state: s.state }), s.grace_released_at && (_jsx("span", { className: "ml-1 text-xs text-amber-700", title: "Force-released on grace", children: "\u2691" }))] }), _jsx("td", { className: "px-5 py-3 text-gray-500", children: s.certificate_no ?? "—" }), _jsx("td", { className: "px-5 py-3 text-gray-500", children: formatDateTime(s.created_at) }), _jsx("td", { className: "px-5 py-3", children: _jsx("button", { onClick: () => setSelected(s.id), className: "text-xs text-blue-600 hover:underline", children: "Details" }) })] }, s.id))), submissions.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 6, className: "px-5 py-10 text-center text-gray-400", children: "No submissions match these filters." }) }))] })] }) }), selected && _jsx(DetailPanel, { id: selected, onClose: () => setSelected(null) })] }));
}
