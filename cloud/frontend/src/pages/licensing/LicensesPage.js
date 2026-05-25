import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/webClient";
import clsx from "clsx";
export default function LicensesPage() {
    const qc = useQueryClient();
    const [newKey, setNewKey] = useState(null);
    const [selectedTenant, setSelectedTenant] = useState("");
    const { data: licenses = [] } = useQuery({
        queryKey: ["licenses"],
        queryFn: () => api.get("/licenses").then((r) => r.data),
    });
    const { data: tenants = [] } = useQuery({
        queryKey: ["tenants-list"],
        queryFn: () => api.get("/tenants").then((r) => r.data),
    });
    const issueMutation = useMutation({
        mutationFn: (tenantId) => api.post("/licenses", { tenantId }).then((r) => r.data),
        onSuccess: (data) => {
            setNewKey(data);
            qc.invalidateQueries({ queryKey: ["licenses"] });
        },
    });
    const revokeMutation = useMutation({
        mutationFn: (id) => api.delete(`/licenses/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["licenses"] }),
    });
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "API Key Licenses" }), _jsxs("div", { className: "bg-white rounded-xl shadow p-5 space-y-3", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Issue New Key" }), _jsxs("div", { className: "flex gap-3", children: [_jsxs("select", { value: selectedTenant, onChange: (e) => setSelectedTenant(e.target.value), className: "flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm", children: [_jsx("option", { value: "", children: "Select center\u2026" }), tenants.map((t) => _jsx("option", { value: t.id, children: t.name }, t.id))] }), _jsx("button", { onClick: () => selectedTenant && issueMutation.mutate(selectedTenant), disabled: !selectedTenant || issueMutation.isPending, className: "rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50", children: "Issue" })] }), newKey && (_jsxs("div", { className: "rounded-lg bg-yellow-50 border border-yellow-300 p-4 space-y-1", children: [_jsx("p", { className: "text-xs font-semibold text-yellow-800", children: "Copy this key now \u2014 it won't be shown again:" }), _jsx("code", { className: "block text-sm font-mono text-yellow-900 break-all", children: newKey.rawKey }), _jsx("button", { onClick: () => setNewKey(null), className: "text-xs text-yellow-700 underline mt-1", children: "Dismiss" })] }))] }), _jsx("div", { className: "bg-white rounded-xl shadow overflow-hidden", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide", children: _jsx("tr", { children: ["Center", "Issued", "Expires", "Status", ""].map((h) => (_jsx("th", { className: "px-5 py-3 text-left font-semibold", children: h }, h))) }) }), _jsxs("tbody", { className: "divide-y", children: [licenses.map((l) => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-5 py-3 font-medium", children: l.centerName }), _jsx("td", { className: "px-5 py-3 text-gray-500", children: new Date(l.issuedAt).toLocaleDateString() }), _jsx("td", { className: "px-5 py-3 text-gray-500", children: l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : "Never" }), _jsx("td", { className: "px-5 py-3", children: _jsx("span", { className: clsx("rounded-full px-2 py-0.5 text-xs font-medium", l.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"), children: l.active ? "Active" : "Revoked" }) }), _jsx("td", { className: "px-5 py-3", children: l.active && (_jsx("button", { onClick: () => revokeMutation.mutate(l.id), className: "text-xs text-red-600 hover:underline", children: "Revoke" })) })] }, l.id))), licenses.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 5, className: "px-5 py-10 text-center text-gray-400", children: "No licenses issued." }) }))] })] }) })] }));
}
