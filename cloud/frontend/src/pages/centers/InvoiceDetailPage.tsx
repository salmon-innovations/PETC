import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api/webClient";
import { formatCentavos, formatDateTime, parsePesosToCentavos } from "../../utils/money";

interface InvoiceDetail {
  id: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  issued_at: string;
  due_at: string;
  subtotal_centavos: number;
  adjustment_centavos: number;
  total_centavos: number;
  amount_paid_centavos: number;
  status: string;
  center_name_snapshot: string;
  lines: Array<{ description: string; quantity: number; unit_amount_centavos: number; amount_centavos: number }>;
  usage: Array<{ submission_id: string; test_id: string; cec_number: string | null; acceptance_seq: number; amount_centavos: number; accepted_at: string }>;
  payments: Array<{ id: string; amount_centavos: number; method: string; external_reference: string; recorded_by: string; paid_at: string }>;
}

export default function InvoiceDetailPage() {
  const { tenantId = "", invoiceId = "" } = useParams();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: invoice } = useQuery<InvoiceDetail>({
    queryKey: ["billing-invoice", tenantId, invoiceId],
    queryFn: () => api.get<InvoiceDetail>(`/admin/billing/centers/${tenantId}/invoices/${invoiceId}`).then((r) => r.data),
  });
  const payment = useMutation({
    mutationFn: (amountCentavos: number) => api.post(`/admin/billing/centers/${tenantId}/invoices/${invoiceId}/payments`, {
      amountCentavos, method, externalReference: reference,
    }),
    onSuccess: () => {
      setAmount(""); setReference(""); setError(null);
      qc.invalidateQueries({ queryKey: ["billing-invoice", tenantId, invoiceId] });
      qc.invalidateQueries({ queryKey: ["billing-invoices", tenantId] });
    },
    onError: () => setError("Payment could not be recorded. Check the outstanding amount and unique reference."),
  });

  if (!invoice) return <div className="p-6">Loading invoice…</div>;
  const outstanding = invoice.total_centavos - invoice.amount_paid_centavos;
  const submit = () => {
    const centavos = parsePesosToCentavos(amount);
    if (centavos === null || centavos <= 0 || centavos > outstanding || !reference.trim()) {
      setError("Enter an amount up to the outstanding balance and a payment reference.");
      return;
    }
    payment.mutate(centavos);
  };

  return <div className="max-w-5xl mx-auto p-6 space-y-6">
    <div className="text-sm flex justify-between"><div><Link to={`/centers/${tenantId}`} className="text-blue-600 hover:underline">Center billing</Link><span className="text-gray-400"> / {invoice.invoice_number}</span></div><button onClick={() => window.print()} className="text-blue-600 hover:underline">Print / save PDF</button></div>
    <section className="bg-white rounded-xl shadow p-5 grid grid-cols-4 gap-4">
      <Metric label="Status" value={invoice.status} /><Metric label="Total" value={formatCentavos(invoice.total_centavos)} /><Metric label="Paid" value={formatCentavos(invoice.amount_paid_centavos)} /><Metric label="Outstanding" value={formatCentavos(outstanding)} />
      <p className="col-span-4 text-xs text-gray-500">Period {formatDateTime(invoice.period_start)} to {formatDateTime(invoice.period_end)} · due {formatDateTime(invoice.due_at)}</p>
    </section>
    {outstanding > 0 && invoice.status !== "VOID" && <section className="bg-white rounded-xl shadow p-5 space-y-3">
      <h2 className="font-semibold">Record settlement</h2><div className="flex gap-3 items-end">
        <label className="text-xs">Amount (₱)<input value={amount} onChange={(e) => setAmount(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm" /></label>
        <label className="text-xs">Method<select value={method} onChange={(e) => setMethod(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm"><option>BANK_TRANSFER</option><option>CASH</option><option>CHECK</option><option>OTHER</option></select></label>
        <label className="text-xs flex-1">Reference<input value={reference} onChange={(e) => setReference(e.target.value)} className="block border rounded-lg px-3 py-2 text-sm w-full" /></label>
        <button onClick={submit} disabled={payment.isPending} className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm disabled:opacity-50">Record payment</button>
      </div>{error && <p className="text-xs text-red-600">{error}</p>}
    </section>}
    <section className="bg-white rounded-xl shadow overflow-hidden"><h2 className="font-semibold px-5 py-3 border-b">Accepted CEC detail</h2><table className="w-full text-sm"><thead><tr className="bg-gray-50 text-left text-xs text-gray-500"><th className="px-5 py-2">Test</th><th>CEC</th><th>Accepted</th><th className="px-5 text-right">Charge</th></tr></thead><tbody className="divide-y">{invoice.usage.map((usage) => <tr key={`${usage.submission_id}-${usage.acceptance_seq}`}><td className="px-5 py-3">{usage.test_id}</td><td>{usage.cec_number ?? "—"}</td><td>{formatDateTime(usage.accepted_at)}</td><td className="px-5 text-right">{formatCentavos(usage.amount_centavos)}</td></tr>)}</tbody></table></section>
    <section className="bg-white rounded-xl shadow overflow-hidden"><h2 className="font-semibold px-5 py-3 border-b">Payment history</h2><table className="w-full text-sm"><tbody className="divide-y">{invoice.payments.map((row) => <tr key={row.id}><td className="px-5 py-3">{row.method}</td><td>{row.external_reference}</td><td>{row.recorded_by}</td><td>{formatDateTime(row.paid_at)}</td><td className="px-5 text-right">{formatCentavos(row.amount_centavos)}</td></tr>)}{invoice.payments.length === 0 && <tr><td className="p-8 text-center text-gray-400">No payments recorded.</td></tr>}</tbody></table></section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase text-gray-500">{label}</p><p className="text-lg font-semibold">{value}</p></div>;
}
