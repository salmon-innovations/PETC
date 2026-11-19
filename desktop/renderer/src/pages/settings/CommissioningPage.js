import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { sidecarClient, sidecarErrorMessage } from "../../api/sidecarClient";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../../store/authStore";
/** Shared first-run and administrator re-commissioning wizard. */
export default function CommissioningPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const { data: status } = useQuery({ queryKey: ["sidecar-status"], queryFn: sidecarClient.getStatus });
    const [form, setForm] = useState({ cloudUrl: "", cloudKey: "", expectedCenter: "", expectedLane: "" });
    const [resolved, setResolved] = useState(null);
    const [error, setError] = useState(null);
    const validate = useMutation({
        mutationFn: () => sidecarClient.validateCommissioning(form),
        onSuccess: (value) => { setResolved(value); setError(null); },
        onError: (err) => { setResolved(null); setError(sidecarErrorMessage(err)); },
    });
    const save = useMutation({
        mutationFn: () => sidecarClient.saveCommissioning(form),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["sidecar-status"] });
            navigate("/test", { replace: true });
        },
        onError: (err) => setError(sidecarErrorMessage(err)),
    });
    const change = (name, value) => {
        setForm((old) => ({ ...old, [name]: value }));
        setResolved(null);
    };
    // An unconfigured installation must be commissionable before an operator
    // can sign in. Once configured, this becomes an administrator task reached
    // from Settings; the sidecar also requires its Electron-only capability.
    if (status?.configured && !status.commissioningRequired && !user)
        return _jsx(Navigate, { to: "/login", replace: true });
    if (status?.configured && !status.commissioningRequired && user && !["manager", "tenant_admin"].includes(user.role)) {
        return _jsx("div", { className: "min-h-screen grid place-items-center text-sm text-gray-700", children: "Cloud reconfiguration requires a PETC manager or tenant administrator." });
    }
    return (_jsx("div", { className: "min-h-screen bg-slate-100 flex items-center justify-center p-6", children: _jsxs("section", { className: "w-full max-w-2xl rounded-xl bg-white shadow p-7 space-y-5", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-bold text-gray-900", children: "PETC commissioning" }), _jsx("p", { className: "mt-1 text-sm text-gray-600", children: "Connect this workstation to its issued cloud lane. Testing stays blocked until the identity, wallet, and daily quota are checked." })] }), _jsxs("div", { className: "grid gap-4 sm:grid-cols-2", children: [_jsx(Field, { label: "Cloud URL", children: _jsx("input", { value: form.cloudUrl, onChange: (e) => change("cloudUrl", e.target.value), placeholder: "https://cloud.example.gov", autoComplete: "url" }) }), _jsx(Field, { label: "Issued lane key", children: _jsx("input", { type: "password", value: form.cloudKey, onChange: (e) => change("cloudKey", e.target.value), placeholder: "Issued lane key", autoComplete: "new-password" }) }), _jsx(Field, { label: "Expected center", children: _jsx("input", { value: form.expectedCenter, onChange: (e) => change("expectedCenter", e.target.value), placeholder: "PETC-001" }) }), _jsx(Field, { label: "Expected lane number", children: _jsx("input", { inputMode: "numeric", value: form.expectedLane, onChange: (e) => change("expectedLane", e.target.value), placeholder: "1" }) })] }), error && _jsx("p", { className: "rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700", children: error }), _jsx("button", { type: "button", onClick: () => validate.mutate(), disabled: validate.isPending || !Object.values(form).every(Boolean), className: "rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50", children: validate.isPending ? "Checking cloud…" : "Validate connection" }), resolved && (_jsxs("div", { className: resolved.identityValid ? "rounded border border-green-200 bg-green-50 p-4 text-sm" : "rounded border border-red-200 bg-red-50 p-4 text-sm", children: [_jsx("p", { className: "font-semibold", children: resolved.identityValid ? "Credential identity resolved" : "Identity cannot be commissioned" }), _jsxs("dl", { className: "mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700", children: [_jsx("dt", { children: "Center" }), _jsxs("dd", { children: [resolved.centerName ?? resolved.centerId, " (", resolved.centerId, ")"] }), _jsx("dt", { children: "Lane" }), _jsxs("dd", { children: [resolved.laneId, " / #", resolved.laneNumber] }), _jsx("dt", { children: "Wallet" }), _jsxs("dd", { children: ["\u20B1", (resolved.walletBalanceCentavos / 100).toFixed(2)] }), _jsx("dt", { children: "Quota" }), _jsxs("dd", { children: [resolved.quotaUsed, " accepted, ", resolved.quotaReserved, " reserved, ", resolved.quotaRemaining, " remaining"] })] }), _jsx("p", { className: "mt-3 text-xs", children: resolved.reason }), resolved.identityValid && (_jsxs("div", { className: "mt-4 border-t border-current/10 pt-3", children: [_jsx("p", { className: "text-xs mb-2", children: "I confirm this is the intended PETC center and lane. Saving replaces this workstation\u2019s cloud credential." }), _jsx("button", { type: "button", onClick: () => save.mutate(), disabled: save.isPending, className: "rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50", children: save.isPending ? "Saving…" : "Confirm and save commissioning" })] }))] })), _jsxs("p", { className: "text-xs text-gray-500", children: ["The lane key is masked in diagnostics and is never displayed or written to logs. ", _jsx(Link, { className: "underline", to: "/login?diagnostics=1", children: "Open diagnostics / sign in" })] })] }) }));
}
function Field({ label, children }) {
    return _jsxs("label", { className: "block text-sm font-medium text-gray-700 space-y-1", children: [_jsx("span", { children: label }), children] });
}
