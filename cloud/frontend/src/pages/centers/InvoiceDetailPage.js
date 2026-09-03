import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api/webClient";
import { formatCentavos, formatDateTime, parsePesosToCentavos } from "../../utils/money";
export default function InvoiceDetailPage() {
    const { tenantId = "", invoiceId = "" } = useParams();
    const qc = useQueryClient();
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState("BANK_TRANSFER");
    const [reference, setReference] = useState("");
    const [error, setError] = useState(null);
    const { data: invoice } = useQuery({
        queryKey: ["billing-invoice", tenantId, invoiceId],
        queryFn: () => api.get(`/admin/billing/centers/${tenantId}/invoices/${invoiceId}`).then((r) => r.data),
    });
    const payment = useMutation({
        mutationFn: (amountCentavos) => api.post(`/admin/billing/centers/${tenantId}/invoices/${invoiceId}/payments`, {
            amountCentavos, method, externalReference: reference,
        }),
        onSuccess: () => {
            setAmount("");
            setReference("");
            setError(null);
            qc.invalidateQueries({ queryKey: ["billing-invoice", tenantId, invoiceId] });
            qc.invalidateQueries({ queryKey: ["billing-invoices", tenantId] });
        },
        onError: () => setError("Payment could not be recorded. Check the outstanding amount and unique reference."),
    });
    if (!invoice)
        return _jsx("div", { className: "p-6", children: "Loading invoice\u2026" });
    const outstanding = invoice.total_centavos - invoice.amount_paid_centavos;
    const submit = () => {
        const centavos = parsePesosToCentavos(amount);
        if (centavos === null || centavos <= 0 || centavos > outstanding || !reference.trim()) {
            setError("Enter an amount up to the outstanding balance and a payment reference.");
            return;
        }
        payment.mutate(centavos);
    };
    return _jsxs("div", { className: "max-w-5xl mx-auto p-6 space-y-6", children: [_jsxs("div", { className: "text-sm flex justify-between", children: [_jsxs("div", { children: [_jsx(Link, { to: `/centers/${tenantId}`, className: "text-blue-600 hover:underline", children: "Center billing" }), _jsxs("span", { className: "text-gray-400", children: [" / ", invoice.invoice_number] })] }), _jsx("button", { onClick: () => window.print(), className: "text-blue-600 hover:underline", children: "Print / save PDF" })] }), _jsxs("section", { className: "bg-white rounded-xl shadow p-5 grid grid-cols-4 gap-4", children: [_jsx(Metric, { label: "Status", value: invoice.status }), _jsx(Metric, { label: "Total", value: formatCentavos(invoice.total_centavos) }), _jsx(Metric, { label: "Paid", value: formatCentavos(invoice.amount_paid_centavos) }), _jsx(Metric, { label: "Outstanding", value: formatCentavos(outstanding) }), _jsxs("p", { className: "col-span-4 text-xs text-gray-500", children: ["Period ", formatDateTime(invoice.period_start), " to ", formatDateTime(invoice.period_end), " \u00B7 due ", formatDateTime(invoice.due_at)] })] }), outstanding > 0 && invoice.status !== "VOID" && _jsxs("section", { className: "bg-white rounded-xl shadow p-5 space-y-3", children: [_jsx("h2", { className: "font-semibold", children: "Record settlement" }), _jsxs("div", { className: "flex gap-3 items-end", children: [_jsxs("label", { className: "text-xs", children: ["Amount (\u20B1)", _jsx("input", { value: amount, onChange: (e) => setAmount(e.target.value), className: "block border rounded-lg px-3 py-2 text-sm" })] }), _jsxs("label", { className: "text-xs", children: ["Method", _jsxs("select", { value: method, onChange: (e) => setMethod(e.target.value), className: "block border rounded-lg px-3 py-2 text-sm", children: [_jsx("option", { children: "BANK_TRANSFER" }), _jsx("option", { children: "CASH" }), _jsx("option", { children: "CHECK" }), _jsx("option", { children: "OTHER" })] })] }), _jsxs("label", { className: "text-xs flex-1", children: ["Reference", _jsx("input", { value: reference, onChange: (e) => setReference(e.target.value), className: "block border rounded-lg px-3 py-2 text-sm w-full" })] }), _jsx("button", { onClick: submit, disabled: payment.isPending, className: "bg-blue-600 text-white rounded-lg px-5 py-2 text-sm disabled:opacity-50", children: "Record payment" })] }), error && _jsx("p", { className: "text-xs text-red-600", children: error })] }), _jsxs("section", { className: "bg-white rounded-xl shadow overflow-hidden", children: [_jsx("h2", { className: "font-semibold px-5 py-3 border-b", children: "Accepted CEC detail" }), _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "bg-gray-50 text-left text-xs text-gray-500", children: [_jsx("th", { className: "px-5 py-2", children: "Test" }), _jsx("th", { children: "CEC" }), _jsx("th", { children: "Accepted" }), _jsx("th", { className: "px-5 text-right", children: "Charge" })] }) }), _jsx("tbody", { className: "divide-y", children: invoice.usage.map((usage) => _jsxs("tr", { children: [_jsx("td", { className: "px-5 py-3", children: usage.test_id }), _jsx("td", { children: usage.cec_number ?? "—" }), _jsx("td", { children: formatDateTime(usage.accepted_at) }), _jsx("td", { className: "px-5 text-right", children: formatCentavos(usage.amount_centavos) })] }, `${usage.submission_id}-${usage.acceptance_seq}`)) })] })] }), _jsxs("section", { className: "bg-white rounded-xl shadow overflow-hidden", children: [_jsx("h2", { className: "font-semibold px-5 py-3 border-b", children: "Payment history" }), _jsx("table", { className: "w-full text-sm", children: _jsxs("tbody", { className: "divide-y", children: [invoice.payments.map((row) => _jsxs("tr", { children: [_jsx("td", { className: "px-5 py-3", children: row.method }), _jsx("td", { children: row.external_reference }), _jsx("td", { children: row.recorded_by }), _jsx("td", { children: formatDateTime(row.paid_at) }), _jsx("td", { className: "px-5 text-right", children: formatCentavos(row.amount_centavos) })] }, row.id)), invoice.payments.length === 0 && _jsx("tr", { children: _jsx("td", { className: "p-8 text-center text-gray-400", children: "No payments recorded." }) })] }) })] })] });
}
function Metric({ label, value }) {
    return _jsxs("div", { children: [_jsx("p", { className: "text-xs uppercase text-gray-500", children: label }), _jsx("p", { className: "text-lg font-semibold", children: value })] });
}
