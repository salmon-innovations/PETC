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
  lowBalanceThresholdCentavos: number;
  pricingUpdatedAt: string;
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
  created_at: string;
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
  const [price, setPrice] = useState("");
  const [lowThreshold, setLowThreshold] = useState("");
  const [pricingMessage, setPricingMessage] = useState<string | null>(null);

  const { data: wallet } = useQuery<WalletDetail>({
    queryKey: ["wallet", tenantId],
    queryFn: () => api.get<WalletDetail>(`/wallet/centers/${tenantId}`).then((r) => r.data),
    refetchInterval: 15_000,
  });

  const { data: ledger = [] } = useQuery<LedgerEntry[]>({
    queryKey: ["ledger", tenantId],
    queryFn: () => api.get<LedgerEntry[]>(`/wallet/centers/${tenantId}/ledger?limit=100`).then((r) => r.data),
  });

  useEffect(() => {
    if (!wallet) return;
    setPrice(String(wallet.chargePerUploadCentavos / 100));
    setLowThreshold(String(wallet.lowBalanceThresholdCentavos / 100));
  }, [wallet?.chargePerUploadCentavos, wallet?.lowBalanceThresholdCentavos]);

  const updatePricing = useMutation({
    mutationFn: (body: {
      chargePerUploadCentavos: number;
      lowBalanceThresholdCentavos: number;
    }) => api.put(`/wallet/centers/${tenantId}/pricing`, body).then((r) => r.data),
    onSuccess: () => {
      setPricingMessage("Pricing updated. Existing submissions keep their quoted price.");
      qc.invalidateQueries({ queryKey: ["wallet", tenantId] });
      qc.invalidateQueries({ queryKey: ["wallet-centers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: () => setPricingMessage("Pricing update failed. Check both amounts and try again."),
  });

  const savePricing = () => {
    const charge = parsePesosToCentavos(price);
    const threshold = parsePesosToCentavos(lowThreshold);
    if (charge === null || charge < 0 || threshold === null || threshold < 0) {
      setPricingMessage("Price and warning threshold must be zero or greater.");
      return;
    }
    updatePricing.mutate({
      chargePerUploadCentavos: charge,
      lowBalanceThresholdCentavos: threshold,
    });
  };

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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/centers" className="text-blue-600 hover:underline">Centers</Link>
        <span className="text-gray-400">/</span>
        <span className="text-gray-700">Wallet</span>
      </div>

      {/* Balance */}
      <div className="bg-white rounded-xl shadow p-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Balance</p>
        <p className={clsx(
          "mt-1 text-3xl font-semibold",
          wallet?.negative ? "text-red-600" : wallet?.low ? "text-amber-600" : "text-gray-800"
        )}>
          {wallet ? formatCentavos(wallet.balanceCentavos) : "…"}
        </p>
        {wallet && (
          <p className="mt-1 text-xs text-gray-500">
            {formatCentavos(wallet.chargePerUploadCentavos)} per accepted CEC
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

      {/* Per-center pricing */}
      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <h2 className="font-semibold text-sm text-gray-700">Center pricing</h2>
        <p className="text-xs text-gray-500">
          Changes apply immediately to newly received submissions. A queued, held, or retried
          submission keeps the price quoted when the cloud received it.
        </p>
        <div className="flex gap-3 items-end">
          <div className="w-48">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Price per accepted CEC (₱)
            </label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-48">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Low-balance warning (₱)
            </label>
            <input
              value={lowThreshold}
              onChange={(e) => setLowThreshold(e.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={savePricing}
            disabled={updatePricing.isPending}
            className="rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {updatePricing.isPending ? "Saving…" : "Save pricing"}
          </button>
        </div>
        {wallet?.pricingUpdatedAt && (
          <p className="text-xs text-gray-400">
            Last pricing update: {formatDateTime(wallet.pricingUpdatedAt)}
          </p>
        )}
        {pricingMessage && <p className="text-xs text-gray-600">{pricingMessage}</p>}
      </div>

      {/* Top up */}
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
