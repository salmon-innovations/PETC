import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import clsx from "clsx";
import { api } from "../../api/webClient";
import { formatCentavos, formatDateTime, parsePesosToCentavos } from "../../utils/money";
const TYPE_STYLES = {
    TOPUP: "text-green-700",
    CHARGE: "text-red-600",
    ADJUSTMENT: "text-blue-700",
};
export default function CenterDetailPage() {
    const { tenantId = "" } = useParams();
    const qc = useQueryClient();
    const [amount, setAmount] = useState("");
    const [reference, setReference] = useState("");
    const [error, setError] = useState(null);
    const [useDefaultCharge, setUseDefaultCharge] = useState(true);
    const [chargeAmount, setChargeAmount] = useState("");
    const [chargeInitialized, setChargeInitialized] = useState(false);
    const [chargeError, setChargeError] = useState(null);
    const { data: wallet } = useQuery({
        queryKey: ["wallet", tenantId],
        queryFn: () => api.get(`/wallet/centers/${tenantId}`).then((r) => r.data),
        refetchInterval: 15_000,
    });
    const { data: ledger = [] } = useQuery({
        queryKey: ["ledger", tenantId],
        queryFn: () => api.get(`/wallet/centers/${tenantId}/ledger?limit=100`).then((r) => r.data),
    });
    useEffect(() => {
        if (!wallet || chargeInitialized)
            return;
        setUseDefaultCharge(wallet.chargeOverrideCentavos === null);
        setChargeAmount(wallet.chargeOverrideCentavos === null
            ? ""
            : String(wallet.chargeOverrideCentavos / 100));
        setChargeInitialized(true);
    }, [chargeInitialized, wallet]);
    const updateCharge = useMutation({
        mutationFn: (chargeOverrideCentavos) => api.put(`/wallet/centers/${tenantId}/cec-charge`, {
            chargeOverrideCentavos,
        }).then((response) => response.data),
        onSuccess: (updated) => {
            setUseDefaultCharge(updated.chargeOverrideCentavos === null);
            setChargeAmount(updated.chargeOverrideCentavos === null
                ? ""
                : String(updated.chargeOverrideCentavos / 100));
            setChargeError(null);
            qc.setQueryData(["wallet", tenantId], updated);
            qc.invalidateQueries({ queryKey: ["wallet-centers"] });
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
        },
        onError: () => setChargeError("Unable to update the center's CEC price."),
    });
    const topUp = useMutation({
        mutationFn: (body) => api.post(`/wallet/centers/${tenantId}/topup`, body).then((r) => r.data),
        onSuccess: () => {
            setAmount("");
            setReference("");
            setError(null);
            qc.invalidateQueries({ queryKey: ["wallet", tenantId] });
            qc.invalidateQueries({ queryKey: ["ledger", tenantId] });
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
        },
        onError: () => setError("Top-up failed. Check the amount and try again."),
    });
    const submit = () => {
        // Convert at the boundary: the API only ever sees integer centavos.
        const centavos = parsePesosToCentavos(amount);
        if (centavos === null || centavos <= 0) {
            setError("Enter an amount greater than zero.");
            return;
        }
        topUp.mutate({ amountCentavos: centavos, reference });
    };
    const saveCharge = () => {
        if (useDefaultCharge) {
            updateCharge.mutate(null);
            return;
        }
        const centavos = parsePesosToCentavos(chargeAmount);
        if (centavos === null || centavos < 0) {
            setChargeError("Enter a valid price of zero or greater.");
            return;
        }
        updateCharge.mutate(centavos);
    };
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-6 space-y-6", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm", children: [_jsx(Link, { to: "/centers", className: "text-blue-600 hover:underline", children: "Centers" }), _jsx("span", { className: "text-gray-400", children: "/" }), _jsx("span", { className: "text-gray-700", children: "Wallet" })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("p", { className: "text-xs font-medium text-gray-500 uppercase tracking-wide", children: "Balance" }), _jsx("p", { className: clsx("mt-1 text-3xl font-semibold", wallet?.negative ? "text-red-600" : wallet?.low ? "text-amber-600" : "text-gray-800"), children: wallet ? formatCentavos(wallet.balanceCentavos) : "…" }), wallet && (_jsxs("p", { className: "mt-1 text-xs text-gray-500", children: [formatCentavos(wallet.chargePerUploadCentavos), " per accepted CEC", wallet.chargeOverrideCentavos === null ? " · platform default" : " · center override", wallet.blockedCount > 0 && (_jsxs("span", { className: "ml-2 text-amber-700 font-medium", children: ["\u00B7 ", wallet.blockedCount, " submission", wallet.blockedCount > 1 ? "s" : "", " held"] }))] })), wallet && !wallet.balanceMatches && (_jsxs("p", { className: "mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2", children: ["Ledger disagrees with the cached balance (", formatCentavos(wallet.derivedBalanceCentavos), " derived). This is a bug \u2014 the ledger is authoritative."] }))] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-5 space-y-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "CEC upload price" }), _jsxs("p", { className: "mt-1 text-xs text-gray-500", children: ["The platform default is ", wallet
                                        ? formatCentavos(wallet.defaultChargePerUploadCentavos)
                                        : "…", " per accepted CEC. A center override applies only to submissions received after it is saved; queued submissions keep their quoted price."] })] }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-gray-700", children: [_jsx("input", { type: "checkbox", checked: useDefaultCharge, onChange: (event) => {
                                    setUseDefaultCharge(event.target.checked);
                                    setChargeError(null);
                                } }), "Use platform default"] }), _jsxs("div", { className: "flex items-end gap-3", children: [_jsxs("div", { className: "w-48", children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Center price per accepted CEC (\u20B1)" }), _jsx("input", { value: chargeAmount, onChange: (event) => setChargeAmount(event.target.value), disabled: useDefaultCharge, placeholder: wallet ? String(wallet.defaultChargePerUploadCentavos / 100) : "80.00", inputMode: "decimal", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400" })] }), _jsx("button", { onClick: saveCharge, disabled: updateCharge.isPending || !wallet, className: "rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50", children: updateCharge.isPending ? "Saving…" : "Save CEC price" })] }), chargeError && _jsx("p", { className: "text-xs text-red-600", children: chargeError })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-5 space-y-3", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Record a top-up" }), _jsx("p", { className: "text-xs text-gray-500", children: "Credits are immutable ledger entries recording you as the actor. Held submissions are released automatically, oldest first, as far as the new balance covers them." }), _jsxs("div", { className: "flex gap-3 items-end", children: [_jsxs("div", { className: "w-40", children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Amount (\u20B1)" }), _jsx("input", { value: amount, onChange: (e) => setAmount(e.target.value), placeholder: "500.00", inputMode: "decimal", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { className: "flex-1", children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Payment reference" }), _jsx("input", { value: reference, onChange: (e) => setReference(e.target.value), placeholder: "GCash ref 12345", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("button", { onClick: submit, disabled: topUp.isPending, className: "rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50", children: topUp.isPending ? "Recording…" : "Top up" })] }), error && _jsx("p", { className: "text-xs text-red-600", children: error })] }), _jsxs("div", { className: "bg-white rounded-xl shadow overflow-hidden", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700 px-5 py-3 border-b", children: "Transaction history" }), _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide", children: _jsx("tr", { children: ["Type", "Detail", "Amount", "Balance", "When"].map((h) => (_jsx("th", { className: "px-5 py-3 text-left font-semibold", children: h }, h))) }) }), _jsxs("tbody", { className: "divide-y", children: [ledger.map((l) => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: clsx("px-5 py-3 font-medium", TYPE_STYLES[l.entry_type]), children: l.entry_type }), _jsxs("td", { className: "px-5 py-3 text-xs text-gray-500", children: [l.note ?? "—", l.created_by && _jsx("span", { className: "block text-gray-400", children: l.created_by })] }), _jsxs("td", { className: clsx("px-5 py-3 font-medium", TYPE_STYLES[l.entry_type]), children: [l.amount_centavos > 0 ? "+" : "", formatCentavos(l.amount_centavos)] }), _jsx("td", { className: "px-5 py-3 text-gray-600", children: formatCentavos(l.balance_after) }), _jsx("td", { className: "px-5 py-3 text-xs text-gray-500", children: formatDateTime(l.created_at) })] }, l.id))), ledger.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 5, className: "px-5 py-10 text-center text-gray-400", children: "No transactions yet." }) }))] })] })] })] }));
}
