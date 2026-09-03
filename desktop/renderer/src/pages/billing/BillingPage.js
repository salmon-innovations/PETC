import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sidecarClient } from "../../api/sidecarClient";
function money(centavos) {
    return ((centavos ?? 0) / 100).toLocaleString("en-PH", {
        style: "currency", currency: "PHP",
    });
}
export default function BillingPage() {
    const qc = useQueryClient();
    const [amount, setAmount] = useState("500.00");
    const [topup, setTopup] = useState(null);
    const [error, setError] = useState(null);
    const [invoiceDetail, setInvoiceDetail] = useState(null);
    const { data: summary, isLoading } = useQuery({
        queryKey: ["billing-summary"], queryFn: sidecarClient.getBillingSummary,
        refetchInterval: 30_000,
    });
    const { data: invoices = [] } = useQuery({
        queryKey: ["billing-invoices"], queryFn: sidecarClient.getBillingInvoices,
        enabled: summary?.mode === "POSTPAID",
    });
    const create = useMutation({
        mutationFn: (centavos) => sidecarClient.createBillingTopUp(centavos, crypto.randomUUID()),
        onSuccess: (created) => { setTopup(created); setError(null); },
        onError: () => setError("Could not create the QR. Check the amount and cloud connection."),
    });
    useEffect(() => {
        if (!topup || topup.status !== "AWAITING_PAYMENT")
            return;
        const timer = window.setInterval(async () => {
            try {
                const latest = await sidecarClient.getBillingTopUp(topup.id);
                setTopup(latest);
                if (latest.status === "PAID") {
                    await qc.invalidateQueries({ queryKey: ["billing-summary"] });
                    await qc.invalidateQueries({ queryKey: ["sidecar-status"] });
                }
            }
            catch {
                // Keep the last known QR while connectivity recovers.
            }
        }, 3_000);
        return () => window.clearInterval(timer);
    }, [qc, topup]);
    if (isLoading)
        return _jsx("div", { className: "p-6", children: "Loading billing\u2026" });
    if (!summary)
        return _jsx("div", { className: "p-6 text-red-700", children: "Cloud billing is unavailable." });
    const submit = () => {
        const pesos = Number(amount);
        if (!Number.isFinite(pesos) || pesos <= 0) {
            setError("Enter a valid amount.");
            return;
        }
        create.mutate(Math.round(pesos * 100));
    };
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-6 space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Billing" }), _jsx("p", { className: "text-sm text-gray-500", children: "Cloud-authoritative account status" })] }), summary.mode === "PREPAID" ? (_jsxs(_Fragment, { children: [_jsxs("section", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("p", { className: "text-xs uppercase text-gray-500", children: "Wallet balance" }), _jsx("p", { className: "text-3xl font-semibold mt-1", children: money(summary.balanceCentavos) }), _jsxs("p", { className: "text-sm text-gray-500 mt-1", children: [money(summary.chargePerUploadCentavos), " per accepted CEC"] }), summary.blockedCount > 0 && _jsxs("p", { className: "text-sm text-amber-700 mt-2", children: [summary.blockedCount, " upload(s) held pending funds"] })] }), _jsxs("section", { className: "bg-white rounded-xl shadow p-5 space-y-3", children: [_jsx("h2", { className: "font-semibold", children: "Reload wallet with QR Ph" }), _jsxs("div", { className: "flex gap-3 items-end", children: [_jsxs("label", { className: "text-sm", children: ["Amount (\u20B1)", _jsx("input", { className: "block mt-1 border rounded-lg px-3 py-2", inputMode: "decimal", value: amount, onChange: (e) => setAmount(e.target.value) })] }), _jsx("button", { className: "bg-blue-600 text-white rounded-lg px-5 py-2 disabled:opacity-50", disabled: create.isPending, onClick: submit, children: create.isPending ? "Creating…" : "Generate QR" })] }), error && _jsx("p", { className: "text-sm text-red-600", children: error }), topup && _jsx(TopUpPanel, { topup: topup })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("section", { className: "grid grid-cols-3 gap-4", children: [_jsx(Metric, { label: "Accepted this cycle", value: String(summary.currentUsageCount ?? 0) }), _jsx(Metric, { label: "Current estimate", value: money(summary.currentEstimateCentavos) }), _jsx(Metric, { label: "Open invoices", value: money(summary.openTotalCentavos) })] }), _jsxs("section", { className: "bg-white rounded-xl shadow p-5", children: [_jsxs("p", { className: "text-sm text-gray-600", children: ["Next cutoff: ", summary.nextCutoff ? new Date(summary.nextCutoff).toLocaleString() : "—"] }), (summary.pastDueInvoiceCount ?? 0) > 0 && _jsxs("p", { className: "mt-2 text-red-700", children: ["Past due: ", money(summary.pastDueTotalCentavos)] })] }), _jsxs("section", { className: "bg-white rounded-xl shadow overflow-hidden", children: [_jsx("h2", { className: "font-semibold px-5 py-3 border-b", children: "Statements" }), _jsx("table", { className: "w-full text-sm", children: _jsxs("tbody", { className: "divide-y", children: [invoices.map((invoice) => (_jsxs("tr", { children: [_jsx("td", { className: "px-5 py-3", children: _jsx("button", { className: "text-blue-600 hover:underline", onClick: () => sidecarClient.getBillingInvoice(invoice.id).then(setInvoiceDetail), children: invoice.invoice_number }) }), _jsx("td", { children: invoice.status }), _jsx("td", { children: new Date(invoice.due_at).toLocaleDateString() }), _jsx("td", { className: "px-5 text-right", children: money(invoice.total_centavos) })] }, invoice.id))), invoices.length === 0 && _jsx("tr", { children: _jsx("td", { className: "p-8 text-center text-gray-400", children: "No statements yet." }) })] }) })] }), invoiceDetail && _jsxs("section", { className: "bg-white rounded-xl shadow overflow-hidden", children: [_jsxs("div", { className: "px-5 py-3 border-b flex justify-between", children: [_jsxs("h2", { className: "font-semibold", children: [invoiceDetail.invoice_number, " accepted CECs"] }), _jsx("button", { className: "text-xs underline", onClick: () => setInvoiceDetail(null), children: "Close" })] }), _jsx("table", { className: "w-full text-sm", children: _jsx("tbody", { className: "divide-y", children: invoiceDetail.usage.map((usage) => _jsxs("tr", { children: [_jsx("td", { className: "px-5 py-3", children: usage.test_id }), _jsx("td", { children: usage.cec_number ?? "—" }), _jsx("td", { children: new Date(usage.accepted_at).toLocaleString() }), _jsx("td", { className: "px-5 text-right", children: money(usage.amount_centavos) })] }, usage.submission_id)) }) })] })] }))] }));
}
function TopUpPanel({ topup }) {
    return _jsxs("div", { className: "border rounded-xl p-4 mt-4 text-center", children: [_jsxs("p", { className: "font-medium", children: [money(topup.amountCentavos), " \u00B7 ", topup.status.replaceAll("_", " ")] }), topup.qrImage && topup.status === "AWAITING_PAYMENT" && _jsx("img", { src: topup.qrImage, alt: "PayMongo QR Ph wallet reload", className: "w-64 h-64 mx-auto my-3" }), topup.expiresAt && topup.status === "AWAITING_PAYMENT" && _jsxs("p", { className: "text-xs text-gray-500", children: ["Expires ", new Date(topup.expiresAt).toLocaleTimeString()] }), topup.testUrl && _jsx("a", { className: "text-xs text-blue-600 underline block mt-2", href: topup.testUrl, target: "_blank", rel: "noreferrer", children: "Simulate test payment" }), topup.status === "PAID" && _jsx("p", { className: "text-green-700 mt-2", children: "Payment verified and wallet credited." }), topup.failureMessage && _jsx("p", { className: "text-red-600 mt-2", children: topup.failureMessage })] });
}
function Metric({ label, value }) {
    return _jsxs("div", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("p", { className: "text-xs uppercase text-gray-500", children: label }), _jsx("p", { className: "text-xl font-semibold mt-1", children: value })] });
}
