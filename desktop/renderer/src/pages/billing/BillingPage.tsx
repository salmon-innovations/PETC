import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sidecarClient, type BillingInvoiceDetail, type BillingTopUp } from "../../api/sidecarClient";

function money(centavos: number | null | undefined) {
  return ((centavos ?? 0) / 100).toLocaleString("en-PH", {
    style: "currency", currency: "PHP",
  });
}

export default function BillingPage() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("500.00");
  const [topup, setTopup] = useState<BillingTopUp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<BillingInvoiceDetail | null>(null);
  const { data: summary, isLoading } = useQuery({
    queryKey: ["billing-summary"], queryFn: sidecarClient.getBillingSummary,
    refetchInterval: 30_000,
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["billing-invoices"], queryFn: sidecarClient.getBillingInvoices,
    enabled: summary?.mode === "POSTPAID",
  });
  const create = useMutation({
    mutationFn: (centavos: number) => sidecarClient.createBillingTopUp(centavos, crypto.randomUUID()),
    onSuccess: (created) => { setTopup(created); setError(null); },
    onError: () => setError("Could not create the QR. Check the amount and cloud connection."),
  });

  useEffect(() => {
    if (!topup || topup.status !== "AWAITING_PAYMENT") return;
    const timer = window.setInterval(async () => {
      try {
        const latest = await sidecarClient.getBillingTopUp(topup.id);
        setTopup(latest);
        if (latest.status === "PAID") {
          await qc.invalidateQueries({ queryKey: ["billing-summary"] });
          await qc.invalidateQueries({ queryKey: ["sidecar-status"] });
        }
      } catch {
        // Keep the last known QR while connectivity recovers.
      }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [qc, topup]);

  if (isLoading) return <div className="p-6">Loading billing…</div>;
  if (!summary) return <div className="p-6 text-red-700">Cloud billing is unavailable.</div>;

  const submit = () => {
    const pesos = Number(amount);
    if (!Number.isFinite(pesos) || pesos <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    create.mutate(Math.round(pesos * 100));
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div><h1 className="text-xl font-bold text-gray-800">Billing</h1><p className="text-sm text-gray-500">Cloud-authoritative account status</p></div>
      {summary.mode === "PREPAID" ? (
        <>
          <section className="bg-white rounded-xl shadow p-5">
            <p className="text-xs uppercase text-gray-500">Wallet balance</p>
            <p className="text-3xl font-semibold mt-1">{money(summary.balanceCentavos)}</p>
            <p className="text-sm text-gray-500 mt-1">{money(summary.chargePerUploadCentavos)} per accepted CEC</p>
            {summary.blockedCount > 0 && <p className="text-sm text-amber-700 mt-2">{summary.blockedCount} upload(s) held pending funds</p>}
          </section>
          <section className="bg-white rounded-xl shadow p-5 space-y-3">
            <h2 className="font-semibold">Reload wallet with QR Ph</h2>
            <div className="flex gap-3 items-end">
              <label className="text-sm">Amount (₱)<input className="block mt-1 border rounded-lg px-3 py-2" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <button className="bg-blue-600 text-white rounded-lg px-5 py-2 disabled:opacity-50" disabled={create.isPending} onClick={submit}>{create.isPending ? "Creating…" : "Generate QR"}</button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {topup && <TopUpPanel topup={topup} />}
          </section>
        </>
      ) : (
        <>
          <section className="grid grid-cols-3 gap-4">
            <Metric label="Accepted this cycle" value={String(summary.currentUsageCount ?? 0)} />
            <Metric label="Current estimate" value={money(summary.currentEstimateCentavos)} />
            <Metric label="Open invoices" value={money(summary.openTotalCentavos)} />
          </section>
          <section className="bg-white rounded-xl shadow p-5">
            <p className="text-sm text-gray-600">Next cutoff: {summary.nextCutoff ? new Date(summary.nextCutoff).toLocaleString() : "—"}</p>
            {(summary.pastDueInvoiceCount ?? 0) > 0 && <p className="mt-2 text-red-700">Past due: {money(summary.pastDueTotalCentavos)}</p>}
          </section>
          <section className="bg-white rounded-xl shadow overflow-hidden">
            <h2 className="font-semibold px-5 py-3 border-b">Statements</h2>
            <table className="w-full text-sm"><tbody className="divide-y">{invoices.map((invoice) => (
              <tr key={invoice.id}><td className="px-5 py-3"><button className="text-blue-600 hover:underline" onClick={() => sidecarClient.getBillingInvoice(invoice.id).then(setInvoiceDetail)}>{invoice.invoice_number}</button></td><td>{invoice.status}</td><td>{new Date(invoice.due_at).toLocaleDateString()}</td><td className="px-5 text-right">{money(invoice.total_centavos)}</td></tr>
            ))}{invoices.length === 0 && <tr><td className="p-8 text-center text-gray-400">No statements yet.</td></tr>}</tbody></table>
          </section>
          {invoiceDetail && <section className="bg-white rounded-xl shadow overflow-hidden"><div className="px-5 py-3 border-b flex justify-between"><h2 className="font-semibold">{invoiceDetail.invoice_number} accepted CECs</h2><button className="text-xs underline" onClick={() => setInvoiceDetail(null)}>Close</button></div><table className="w-full text-sm"><tbody className="divide-y">{invoiceDetail.usage.map((usage) => <tr key={usage.submission_id}><td className="px-5 py-3">{usage.test_id}</td><td>{usage.cec_number ?? "—"}</td><td>{new Date(usage.accepted_at).toLocaleString()}</td><td className="px-5 text-right">{money(usage.amount_centavos)}</td></tr>)}</tbody></table></section>}
        </>
      )}
    </div>
  );
}

function TopUpPanel({ topup }: { topup: BillingTopUp }) {
  return <div className="border rounded-xl p-4 mt-4 text-center">
    <p className="font-medium">{money(topup.amountCentavos)} · {topup.status.replaceAll("_", " ")}</p>
    {topup.qrImage && topup.status === "AWAITING_PAYMENT" && <img src={topup.qrImage} alt="PayMongo QR Ph wallet reload" className="w-64 h-64 mx-auto my-3" />}
    {topup.expiresAt && topup.status === "AWAITING_PAYMENT" && <p className="text-xs text-gray-500">Expires {new Date(topup.expiresAt).toLocaleTimeString()}</p>}
    {topup.testUrl && <a className="text-xs text-blue-600 underline block mt-2" href={topup.testUrl} target="_blank" rel="noreferrer">Simulate test payment</a>}
    {topup.status === "PAID" && <p className="text-green-700 mt-2">Payment verified and wallet credited.</p>}
    {topup.failureMessage && <p className="text-red-600 mt-2">{topup.failureMessage}</p>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-white rounded-xl shadow p-5"><p className="text-xs uppercase text-gray-500">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></div>;
}
