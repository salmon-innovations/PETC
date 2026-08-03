import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "../../api/webClient";
import CentersPage from "../admin/CentersPage";
import LicensesPage from "../../pages/licensing/LicensesPage";
import { formatCentavos, parsePesosToCentavos } from "../../utils/money";
const SECTIONS = [
    { id: "billing", label: "Billing Defaults" },
    { id: "retries", label: "Retry Policy" },
    { id: "centers", label: "Centers" },
    { id: "licenses", label: "API Keys" },
    { id: "users", label: "Users & Roles" },
    { id: "it", label: "IT Configuration" },
];
function Row({ label, hint, children }) {
    return (_jsxs("div", { className: "flex items-start gap-4 py-3 border-b last:border-0", children: [_jsxs("div", { className: "w-64 shrink-0", children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: label }), hint && _jsx("p", { className: "text-xs text-gray-500 mt-0.5", children: hint })] }), _jsx("div", { className: "flex-1", children: children })] }));
}
function Placeholder({ title, body }) {
    return (_jsxs("div", { className: "bg-white rounded-xl shadow p-8 text-center", children: [_jsx("p", { className: "text-sm font-medium text-gray-600", children: title }), _jsx("p", { className: "mt-2 text-xs text-gray-500 max-w-md mx-auto", children: body }), _jsx("span", { className: "inline-block mt-3 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500", children: "Not yet available" })] }));
}
function BillingAndRetries({ section }) {
    const qc = useQueryClient();
    const [form, setForm] = useState({});
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const { data } = useQuery({
        queryKey: ["settings"],
        queryFn: () => api.get("/settings").then((r) => r.data),
    });
    useEffect(() => {
        if (!data)
            return;
        setForm({
            charge: String(data["wallet.charge_per_upload_centavos"] / 100),
            lowBalance: String(data["wallet.low_balance_threshold_centavos"] / 100),
            debtFloor: String(data["wallet.debt_floor_centavos"] / 100),
            grace: String(data["wallet.grace_release_minutes"]),
            maxAttempts: String(data["submission.max_attempts"]),
            backoff: data["submission.backoff_seconds"].join(", "),
        });
    }, [data]);
    const save = useMutation({
        mutationFn: (body) => api.put("/settings", body).then((r) => r.data),
        onSuccess: () => {
            setError(null);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            qc.invalidateQueries({ queryKey: ["settings"] });
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
        },
        onError: (e) => setError(e?.response?.data?.detail ?? "Save failed — check the values."),
    });
    const saveBilling = () => {
        const charge = parsePesosToCentavos(form.charge);
        const low = parsePesosToCentavos(form.lowBalance);
        const floor = parsePesosToCentavos(form.debtFloor);
        if (charge === null || low === null || floor === null) {
            setError("Amounts must be numbers.");
            return;
        }
        save.mutate({
            "wallet.charge_per_upload_centavos": charge,
            "wallet.low_balance_threshold_centavos": low,
            "wallet.debt_floor_centavos": floor,
            "wallet.grace_release_minutes": Number(form.grace),
        });
    };
    const saveRetries = () => {
        const backoff = form.backoff
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n));
        if (backoff.length === 0) {
            setError("Backoff must be a comma-separated list of seconds.");
            return;
        }
        save.mutate({
            "submission.max_attempts": Number(form.maxAttempts),
            "submission.backoff_seconds": backoff,
        });
    };
    const input = (key, props = {}) => (_jsx("input", { value: form[key] ?? "", onChange: (e) => setForm({ ...form, [key]: e.target.value }), className: "w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm", ...props }));
    return (_jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [section === "billing" ? (_jsxs(_Fragment, { children: [_jsxs(Row, { label: "Default charge per accepted CEC", hint: "Used for new centers. Edit an existing center from its wallet page.", children: [input("charge", { inputMode: "decimal" }), _jsxs("span", { className: "ml-2 text-xs text-gray-500", children: [data && formatCentavos(data["wallet.charge_per_upload_centavos"]), " currently"] })] }), _jsx(Row, { label: "Default low balance warning", hint: "Used for new centers. Each center can override it from its wallet page.", children: input("lowBalance", { inputMode: "decimal" }) }), _jsx(Row, { label: "Debt floor", hint: "Grace release STOPS below this. Held filings stay stranded from LTMS until paid \u2014 enter as a negative amount.", children: input("debtFloor", { inputMode: "decimal" }) }), _jsxs(Row, { label: "Grace release window", hint: "Minutes a held submission waits before being filed anyway, so billing cannot cause a DO 2023-008 breach.", children: [input("grace", { inputMode: "numeric" }), _jsx("span", { className: "ml-2 text-xs text-gray-500", children: "minutes" })] }), _jsx("button", { onClick: saveBilling, disabled: save.isPending, className: "mt-4 rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50", children: "Save billing settings" })] })) : (_jsxs(_Fragment, { children: [_jsx(Row, { label: "Max attempts", hint: "Transport failures retried this many times before a submission is marked DEAD.", children: input("maxAttempts", { inputMode: "numeric" }) }), _jsx(Row, { label: "Backoff ladder", hint: "Seconds between retries, comma-separated. The last value repeats.", children: _jsx("input", { value: form.backoff ?? "", onChange: (e) => setForm({ ...form, backoff: e.target.value }), className: "w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono" }) }), _jsx("button", { onClick: saveRetries, disabled: save.isPending, className: "mt-4 rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50", children: "Save retry policy" })] })), error && _jsx("p", { className: "mt-3 text-xs text-red-600", children: error }), saved && _jsx("p", { className: "mt-3 text-xs text-green-600", children: "Saved." })] }));
}
export default function SettingsPage() {
    const [section, setSection] = useState("billing");
    return (_jsxs("div", { className: "max-w-5xl mx-auto p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Platform Settings" }), _jsxs("div", { className: "flex gap-6", children: [_jsx("nav", { className: "w-48 shrink-0 space-y-1", children: SECTIONS.map((s) => (_jsx("button", { onClick: () => setSection(s.id), className: clsx("w-full text-left px-3 py-2 rounded-lg text-sm transition-colors", section === s.id
                                ? "bg-blue-50 text-blue-700 font-medium"
                                : "text-gray-600 hover:bg-gray-100"), children: s.label }, s.id))) }), _jsxs("div", { className: "flex-1 min-w-0", children: [(section === "billing" || section === "retries") && _jsx(BillingAndRetries, { section: section }), section === "centers" && _jsx("div", { className: "-m-6", children: _jsx(CentersPage, {}) }), section === "licenses" && _jsx("div", { className: "-m-6", children: _jsx(LicensesPage, {}) }), section === "users" && (_jsx(Placeholder, { title: "Users & Roles", body: "Center user management is not built yet. Roles exist in the schema but the portal has no\n                    way to create users, and the role model needs work before per-role permissions are safe." })), section === "it" && (_jsx(Placeholder, { title: "IT Configuration", body: "LTMS endpoint and operational configuration will appear here. Credentials will stay in\n                    environment variables rather than the database, so they are never reachable from a web session." }))] })] })] }));
}
