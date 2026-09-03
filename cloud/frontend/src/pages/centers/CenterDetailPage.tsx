import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import clsx from "clsx";
import { api } from "../../api/webClient";
import { formatCentavos, formatDateTime, parsePesosToCentavos } from "../../utils/money";

interface WalletDetail {
  tenantId: string;
  balanceCentavos: number;
  derivedBalanceCentavos: number;
  balanceMatches: boolean;
  low: boolean;
  negative: boolean;
  blockedCount: number;
  chargePerUploadCentavos: number;
  chargeOverrideCentavos: number | null;
  defaultChargePerUploadCentavos: number;
}

interface LedgerEntry {
  id: number;
  entry_type: string;
  amount_centavos: number;
  balance_after: number;
  submission_id: string | null;
  acceptance_seq: number | null;
  created_by: string | null;
  note: string | null;
  provider: string | null;
  external_reference: string | null;
  created_at: string;
}

interface BillingProfile {
  mode: "PREPAID" | "POSTPAID";
  revision: number;
  timezone: string;
  paymentTermsDays: number;
  creditLimitCentavos: number | null;
}

interface BillingInvoice {
  id: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  due_at: string;
  total_centavos: number;
  amount_paid_centavos: number;
  status: string;
}

interface UnbilledUsage {
  id: string;
  test_id: string;
  cec_number: string | null;
  amount_centavos: number;
  accepted_at: string;
}

const TYPE_STYLES: Record<string, string> = {
  TOPUP: "text-green-700",
  CHARGE: "text-red-600",
  ADJUSTMENT: "text-blue-700",
};

export default function CenterDetailPage() {
  const { tenantId = "" } = useParams();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [useDefaultCharge, setUseDefaultCharge] = useState(true);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeInitialized, setChargeInitialized] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [billingMode, setBillingMode] = useState<"PREPAID" | "POSTPAID">("PREPAID");
  const [paymentTermsDays, setPaymentTermsDays] = useState("7");
  const [billingError, setBillingError] = useState<string | null>(null);

  const { data: wallet } = useQuery<WalletDetail>({
    queryKey: ["wallet", tenantId],
    queryFn: () => api.get<WalletDetail>(`/wallet/centers/${tenantId}`).then((r) => r.data),
    refetchInterval: 15_000,
  });

  const { data: ledger = [] } = useQuery<LedgerEntry[]>({
    queryKey: ["ledger", tenantId],
    queryFn: () => api.get<LedgerEntry[]>(`/wallet/centers/${tenantId}/ledger?limit=100`).then((r) => r.data),
  });

  const { data: profile } = useQuery<BillingProfile>({
    queryKey: ["billing-profile", tenantId],
    queryFn: () => api.get<BillingProfile>(`/admin/billing/centers/${tenantId}/profile`).then((r) => r.data),
  });

  const { data: invoices = [] } = useQuery<BillingInvoice[]>({
    queryKey: ["billing-invoices", tenantId],
    queryFn: () => api.get<BillingInvoice[]>(`/admin/billing/centers/${tenantId}/invoices`).then((r) => r.data),
    enabled: profile?.mode === "POSTPAID",
  });

  const { data: unbilledUsage = [] } = useQuery<UnbilledUsage[]>({
    queryKey: ["billing-usage", tenantId],
    queryFn: () => api.get<UnbilledUsage[]>(`/admin/billing/centers/${tenantId}/usage`).then((r) => r.data),
    enabled: profile?.mode === "POSTPAID",
  });

  useEffect(() => {
    if (!profile) return;
    setBillingMode(profile.mode);
    setPaymentTermsDays(String(profile.paymentTermsDays));
  }, [profile]);

  const updateBilling = useMutation({
    mutationFn: () => api.put<BillingProfile>(`/admin/billing/centers/${tenantId}/profile`, {
      mode: billingMode,
      paymentTermsDays: Number(paymentTermsDays),
      creditLimitCentavos: profile?.creditLimitCentavos ?? null,
    }).then((r) => r.data),
    onSuccess: (updated) => {
      qc.setQueryData(["billing-profile", tenantId], updated);
      setBillingError(null);
      qc.invalidateQueries({ queryKey: ["billing-invoices", tenantId] });
    },
    onError: () => setBillingError("Could not change the billing plan. Resolve blocked prepaid submissions first."),
  });

  useEffect(() => {
    if (!wallet || chargeInitialized) return;
    setUseDefaultCharge(wallet.chargeOverrideCentavos === null);
    setChargeAmount(
      wallet.chargeOverrideCentavos === null
        ? ""
        : String(wallet.chargeOverrideCentavos / 100),
    );
    setChargeInitialized(true);
  }, [chargeInitialized, wallet]);

  const updateCharge = useMutation({
    mutationFn: (chargeOverrideCentavos: number | null) =>
      api.put<WalletDetail>(`/wallet/centers/${tenantId}/cec-charge`, {
        chargeOverrideCentavos,
      }).then((response) => response.data),
    onSuccess: (updated) => {
      setUseDefaultCharge(updated.chargeOverrideCentavos === null);
      setChargeAmount(
        updated.chargeOverrideCentavos === null
          ? ""
          : String(updated.chargeOverrideCentavos / 100),
      );
      setChargeError(null);
      qc.setQueryData(["wallet", tenantId], updated);
      qc.invalidateQueries({ queryKey: ["wallet-centers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: () => setChargeError("Unable to update the center's CEC price."),
  });

  const topUp = useMutation({
    mutationFn: (body: { amountCentavos: number; reference: string }) =>
      api.post(`/wallet/centers/${tenantId}/topup`, body).then((r) => r.data),
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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/centers" className="text-blue-600 hover:underline">Centers</Link>
        <span className="text-gray-400">/</span>
        <span className="text-gray-700">Billing</span>
      </div>

      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <div><h2 className="font-semibold text-sm text-gray-700">Billing plan</h2><p className="text-xs text-gray-500 mt-1">Prepaid uses the wallet and QR reloads. Postpaid accrues accepted CECs into semi-monthly statements.</p></div>
        <div className="flex items-end gap-3">
          <label className="text-xs text-gray-600">Plan<select value={billingMode} onChange={(e) => setBillingMode(e.target.value as "PREPAID" | "POSTPAID")} className="block mt-1 border rounded-lg px-3 py-2 text-sm"><option value="PREPAID">Prepaid</option><option value="POSTPAID">Postpaid</option></select></label>
          <label className="text-xs text-gray-600">Payment terms (days)<input value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} type="number" min="0" max="365" className="block mt-1 border rounded-lg px-3 py-2 text-sm w-32" /></label>
          <button onClick={() => updateBilling.mutate()} disabled={updateBilling.isPending || !profile} className="rounded-lg bg-blue-600 px-5 py-2 text-white text-sm disabled:opacity-50">{updateBilling.isPending ? "Saving…" : "Save plan"}</button>
        </div>
        {billingError && <p className="text-xs text-red-600">{billingError}</p>}
      </div>

      {/* Balance */}
      <div className="bg-white rounded-xl shadow p-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{profile?.mode === "POSTPAID" ? "Legacy prepaid balance" : "Balance"}</p>
        <p className={clsx(
          "mt-1 text-3xl font-semibold",
          wallet?.negative ? "text-red-600" : wallet?.low ? "text-amber-600" : "text-gray-800"
        )}>
          {wallet ? formatCentavos(wallet.balanceCentavos) : "…"}
        </p>
        {wallet && (
          <p className="mt-1 text-xs text-gray-500">
            {formatCentavos(wallet.chargePerUploadCentavos)} per accepted CEC
            {wallet.chargeOverrideCentavos === null ? " · platform default" : " · center override"}
            {wallet.blockedCount > 0 && (
              <span className="ml-2 text-amber-700 font-medium">
                · {wallet.blockedCount} submission{wallet.blockedCount > 1 ? "s" : ""} held
              </span>
            )}
          </p>
        )}
        {/* The projection is maintained in the same transaction as each ledger
            insert, so a mismatch means a writer bug rather than lag. */}
        {wallet && !wallet.balanceMatches && (
          <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            Ledger disagrees with the cached balance
            ({formatCentavos(wallet.derivedBalanceCentavos)} derived). This is a bug — the ledger is
            authoritative.
          </p>
        )}
      </div>

      {/* Per-center commercial rate */}
      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-sm text-gray-700">CEC upload price</h2>
          <p className="mt-1 text-xs text-gray-500">
            The platform default is {wallet
              ? formatCentavos(wallet.defaultChargePerUploadCentavos)
              : "…"} per accepted CEC. A center override applies only to submissions received after it is saved;
            queued submissions keep their quoted price.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={useDefaultCharge}
            onChange={(event) => {
              setUseDefaultCharge(event.target.checked);
              setChargeError(null);
            }}
          />
          Use platform default
        </label>
        <div className="flex items-end gap-3">
          <div className="w-48">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Center price per accepted CEC (₱)
            </label>
            <input
              value={chargeAmount}
              onChange={(event) => setChargeAmount(event.target.value)}
              disabled={useDefaultCharge}
              placeholder={wallet ? String(wallet.defaultChargePerUploadCentavos / 100) : "80.00"}
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
            />
          </div>
          <button
            onClick={saveCharge}
            disabled={updateCharge.isPending || !wallet}
            className="rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {updateCharge.isPending ? "Saving…" : "Save CEC price"}
          </button>
        </div>
        {chargeError && <p className="text-xs text-red-600">{chargeError}</p>}
      </div>

      {/* Manual administrative adjustment remains prepaid-only. */}
      {profile?.mode !== "POSTPAID" && (
      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <h2 className="font-semibold text-sm text-gray-700">Record a top-up</h2>
        <p className="text-xs text-gray-500">
          Credits are immutable ledger entries recording you as the actor. Held submissions are
          released automatically, oldest first, as far as the new balance covers them.
        </p>
        <div className="flex gap-3 items-end">
          <div className="w-40">
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₱)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500.00"
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment reference</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="GCash ref 12345"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={submit}
            disabled={topUp.isPending}
            className="rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {topUp.isPending ? "Recording…" : "Top up"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      )}

      {profile?.mode === "POSTPAID" && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <h2 className="font-semibold text-sm text-gray-700 px-5 py-3 border-b">Current uninvoiced usage</h2>
          <table className="w-full text-sm"><tbody className="divide-y">{unbilledUsage.map((usage) => (
            <tr key={usage.id}><td className="px-5 py-3">{usage.test_id}</td><td>{usage.cec_number ?? "—"}</td><td>{formatDateTime(usage.accepted_at)}</td><td className="px-5 text-right">{formatCentavos(usage.amount_centavos)}</td></tr>
          ))}{unbilledUsage.length === 0 && <tr><td className="px-5 py-8 text-center text-gray-400">No uninvoiced accepted CECs.</td></tr>}</tbody></table>
        </div>
      )}

      {profile?.mode === "POSTPAID" && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <h2 className="font-semibold text-sm text-gray-700 px-5 py-3 border-b">Postpaid statements</h2>
          <table className="w-full text-sm"><tbody className="divide-y">{invoices.map((invoice) => (
            <tr key={invoice.id}><td className="px-5 py-3 font-medium"><Link className="text-blue-600 hover:underline" to={`/centers/${tenantId}/invoices/${invoice.id}`}>{invoice.invoice_number}</Link></td><td>{invoice.status}</td><td>{formatDateTime(invoice.due_at)}</td><td className="px-5 text-right">{formatCentavos(invoice.total_centavos)}</td></tr>
          ))}{invoices.length === 0 && <tr><td className="px-5 py-10 text-center text-gray-400">No finalized statements yet.</td></tr>}</tbody></table>
        </div>
      )}

      {/* Ledger */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <h2 className="font-semibold text-sm text-gray-700 px-5 py-3 border-b">
          Transaction history
        </h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {["Type", "Detail", "Amount", "Balance", "When"].map((h) => (
                <th key={h} className="px-5 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {ledger.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className={clsx("px-5 py-3 font-medium", TYPE_STYLES[l.entry_type])}>
                  {l.entry_type}
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {l.note ?? "—"}
                  {l.created_by && <span className="block text-gray-400">{l.created_by}</span>}
                  {l.provider && <span className="block text-gray-400">{l.provider} · {l.external_reference}</span>}
                </td>
                <td className={clsx("px-5 py-3 font-medium", TYPE_STYLES[l.entry_type])}>
                  {l.amount_centavos > 0 ? "+" : ""}{formatCentavos(l.amount_centavos)}
                </td>
                <td className="px-5 py-3 text-gray-600">{formatCentavos(l.balance_after)}</td>
                <td className="px-5 py-3 text-xs text-gray-500">{formatDateTime(l.created_at)}</td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                No transactions yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
