import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { z } from "zod";
import clsx from "clsx";
import { api } from "../../api/webClient";
import { formatCentavos } from "../../utils/money";
const addSchema = z.object({
    name: z.string().min(2, "Name required"),
    slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, hyphens only"),
});
export default function CentersPage() {
    const qc = useQueryClient();
    const { data: centers = [] } = useQuery({
        queryKey: ["centers"],
        queryFn: () => api.get("/tenants").then((r) => r.data),
    });
    const { data: wallets = [] } = useQuery({
        queryKey: ["wallet-centers"],
        queryFn: () => api.get("/wallet/centers").then((r) => r.data),
    });
    const walletByTenant = Object.fromEntries(wallets.map((w) => [w.tenantId, w]));
    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(addSchema) });
    const addMutation = useMutation({
        mutationFn: (data) => api.post("/tenants", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["centers"] }); reset(); },
    });
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Emission Testing Centers" }), _jsxs("form", { onSubmit: handleSubmit((v) => addMutation.mutate(v)), className: "bg-white rounded-xl shadow p-5 flex gap-4 items-end", children: [_jsxs("div", { className: "flex-1", children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Center Name" }), _jsx("input", { ...register("name"), placeholder: "Makati ETC", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" }), errors.name && _jsx("p", { className: "mt-0.5 text-xs text-red-600", children: errors.name.message })] }), _jsxs("div", { className: "flex-1", children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Slug (URL key)" }), _jsx("input", { ...register("slug"), placeholder: "makati-etc", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" }), errors.slug && _jsx("p", { className: "mt-0.5 text-xs text-red-600", children: errors.slug.message })] }), _jsx("button", { type: "submit", disabled: isSubmitting, className: "rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50", children: "Add Center" })] }), _jsx("div", { className: "bg-white rounded-xl shadow overflow-hidden", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide", children: _jsx("tr", { children: ["Name", "Slug", "Price / CEC", "Balance", "Licenses", "Last Sync", ""].map((h) => (_jsx("th", { className: "px-5 py-3 text-left font-semibold", children: h }, h))) }) }), _jsxs("tbody", { className: "divide-y", children: [centers.map((c) => {
                                    const w = walletByTenant[c.id];
                                    return (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-5 py-3 font-medium", children: _jsx(Link, { to: `/centers/${c.id}`, className: "hover:underline", children: c.name }) }), _jsx("td", { className: "px-5 py-3 font-mono text-gray-500", children: c.slug }), _jsx("td", { className: "px-5 py-3 text-gray-700", children: w ? formatCentavos(w.chargePerUploadCentavos) : "—" }), _jsxs("td", { className: clsx("px-5 py-3 font-medium", w?.negative ? "text-red-600" : w?.low ? "text-amber-600" : "text-gray-700"), children: [w ? formatCentavos(w.balanceCentavos) : "—", w && w.blockedCount > 0 && (_jsxs("span", { className: "ml-2 text-xs text-amber-700", children: [w.blockedCount, " held"] }))] }), _jsx("td", { className: "px-5 py-3", children: c.activeLicenses }), _jsx("td", { className: "px-5 py-3 text-gray-500", children: c.lastSync ? new Date(c.lastSync).toLocaleString() : "Never" }), _jsx("td", { className: "px-5 py-3", children: _jsx(Link, { to: `/centers/${c.id}`, className: "text-blue-600 hover:underline text-xs", children: "Wallet" }) })] }, c.id));
                                }), centers.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 7, className: "px-5 py-10 text-center text-gray-400", children: "No centers yet." }) }))] })] }) })] }));
}
