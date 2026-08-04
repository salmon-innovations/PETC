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

/** A lane is an independently provisioned desktop installation under a center. */
interface Lane {
  id: string;
  laneNumber: number;
  active: boolean;
  dailyUploadLimit: number;
  createdAt: string;
  updatedAt: string;
  today: {
    businessDate: string;
    accepted: number;
    reserved: number;
    limit: number;
    remaining: number;
  };
  /** A raw credential is intentionally never returned after issue/rotation. */
  credentialId?: string | null;
  credentialLastUsedAt?: string | null;
}

interface LaneCredentialResponse {
  /** Returned only when a credential is issued or rotated. Never persisted by the UI. */
  id: string;
  rawKey: string;
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

  const { data: lanes = [], isPending: lanesLoading, isError: lanesError } = useQuery<Lane[]>({
    queryKey: ["lanes", tenantId],
    queryFn: () => api.get<Lane[]>(`/tenants/${tenantId}/lanes`).then((r) => r.data),
    refetchInterval: 15_000,
  });

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
        <span className="text-gray-700">Center</span>
      </div>

      <LaneManagement
        tenantId={tenantId}
        lanes={lanes}
        loading={lanesLoading}
        error={lanesError}
      />

      {/* Balance */}
      <div id="wallet" className="bg-white rounded-xl shadow p-5">
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

function LaneManagement({
  tenantId,
  lanes,
  loading,
  error,
}: {
  tenantId: string;
  lanes: Lane[];
  loading: boolean;
  error: boolean;
}) {
  const qc = useQueryClient();
  const [newLimit, setNewLimit] = useState("80");
  const [newLaneNumber, setNewLaneNumber] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [credential, setCredential] = useState<{ laneNumber: number; apiKey: string } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lanes", tenantId] });
    qc.invalidateQueries({ queryKey: ["centers"] });
    qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };

  const addLane = useMutation({
    mutationFn: ({ laneNumber, dailyUploadLimit }: { laneNumber: number; dailyUploadLimit: number }) =>
      api.post<Lane>(`/tenants/${tenantId}/lanes`, { laneNumber, dailyUploadLimit }).then((r) => r.data),
    onSuccess: (lane) => {
      setNewLimit("80");
      setNewLaneNumber("");
      setMessage(`Lane ${lane.laneNumber} added. Issue its desktop credential before use.`);
      refresh();
    },
    onError: () => setMessage("Unable to add the lane. Check the daily limit and try again."),
  });

  const updateLane = useMutation({
    mutationFn: ({ laneId, body }: { laneId: string; body: { active?: boolean; dailyUploadLimit?: number } }) =>
      api.patch<Lane>(`/tenants/${tenantId}/lanes/${laneId}`, body).then((r) => r.data),
    onSuccess: () => { setMessage(null); refresh(); },
    onError: () => setMessage("Unable to update this lane. Try again."),
  });

  const issueCredential = useMutation({
    mutationFn: (laneId: string) =>
      api.post<LaneCredentialResponse>(
        `/tenants/${tenantId}/lanes/${laneId}/credentials`
      ).then((r) => r.data),
    onSuccess: (result, laneId) => {
      const lane = lanes.find((item) => item.id === laneId);
      if (lane) setCredential({ laneNumber: lane.laneNumber, apiKey: result.rawKey });
      refresh();
    },
    onError: () => setMessage("Unable to issue the credential. Try again."),
  });

  const revokeCredential = useMutation({
    mutationFn: ({ laneId, credentialId }: { laneId: string; credentialId: string }) =>
      api.delete(`/tenants/${tenantId}/lanes/${laneId}/credentials/${credentialId}`),
    onSuccess: () => { setMessage("Credential revoked. The lane cannot upload until a new credential is issued."); refresh(); },
    onError: () => setMessage("Unable to revoke the credential. Try again."),
  });

  const createLane = () => {
    const laneNumber = Number(newLaneNumber);
    const limit = Number(newLimit);
    if (!Number.isInteger(laneNumber) || laneNumber < 1) {
      setMessage("Lane number must be a whole number of at least 1.");
      return;
    }
    if (lanes.some((lane) => lane.laneNumber === laneNumber)) {
      setMessage(`Lane ${laneNumber} already exists.`);
      return;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      setMessage("Daily accepted-CEC limit must be a whole number of at least 1.");
      return;
    }
    addLane.mutate({ laneNumber, dailyUploadLimit: limit });
  };

  return (
    <section className="bg-white rounded-xl shadow overflow-hidden">
      <div className="p-5 border-b flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-sm text-gray-700">Lanes</h2>
          <p className="mt-1 text-xs text-gray-500">
            Each lane is one desktop app with one active credential. Its daily limit counts only LTMS-accepted CECs and resets at midnight Philippine time.
          </p>
        </div>
        <a href="#wallet" className="shrink-0 text-xs text-blue-600 hover:underline">Center wallet ↓</a>
      </div>

      <div className="p-5 border-b bg-gray-50 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Lane number</label>
          <input
            aria-label="New lane number"
            value={newLaneNumber}
            onChange={(event) => setNewLaneNumber(event.target.value)}
            inputMode="numeric"
            type="number"
            min="1"
            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Daily accepted-CEC limit</label>
          <input
            aria-label="New lane daily accepted-CEC limit"
            value={newLimit}
            onChange={(event) => setNewLimit(event.target.value)}
            inputMode="numeric"
            type="number"
            min="1"
            className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={createLane}
          disabled={addLane.isPending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {addLane.isPending ? "Adding…" : "Add lane"}
        </button>
        {message && <p role="status" className="text-xs text-gray-600">{message}</p>}
      </div>

      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-gray-400">Loading lanes…</p>
      ) : error ? (
        <p role="alert" className="m-5 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Unable to load lanes from the cloud backend.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {['Lane', 'Today', 'Last activity', 'Status', 'Desktop credential', ''].map((heading) => (
                <th key={heading} className="px-5 py-3 text-left font-semibold">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {lanes.map((lane) => (
              <LaneRow
                key={lane.id}
                lane={lane}
                saving={updateLane.isPending || issueCredential.isPending || revokeCredential.isPending}
                onSetActive={(active) => updateLane.mutate({ laneId: lane.id, body: { active } })}
                onSetLimit={(dailyUploadLimit) => updateLane.mutate({ laneId: lane.id, body: { dailyUploadLimit } })}
                onIssue={() => issueCredential.mutate(lane.id)}
                onRotate={() => issueCredential.mutate(lane.id)}
                onRevoke={() => lane.credentialId && revokeCredential.mutate({ laneId: lane.id, credentialId: lane.credentialId })}
              />
            ))}
            {lanes.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">No lanes yet.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {credential && (
        <CredentialDialog
          laneNumber={credential.laneNumber}
          apiKey={credential.apiKey}
          onClose={() => setCredential(null)}
        />
      )}
    </section>
  );
}

function LaneRow({
  lane,
  saving,
  onSetActive,
  onSetLimit,
  onIssue,
  onRotate,
  onRevoke,
}: {
  lane: Lane;
  saving: boolean;
  onSetActive: (active: boolean) => void;
  onSetLimit: (limit: number) => void;
  onIssue: () => void;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const [limit, setLimit] = useState(String(lane.dailyUploadLimit));
  useEffect(() => setLimit(String(lane.dailyUploadLimit)), [lane.dailyUploadLimit]);
  const saveLimit = () => {
    const parsed = Number(limit);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed !== lane.dailyUploadLimit) onSetLimit(parsed);
    else setLimit(String(lane.dailyUploadLimit));
  };
  const isAtLimit = lane.today.accepted >= lane.today.limit;

  return (
    <tr className={clsx("hover:bg-gray-50", !lane.active && "bg-gray-50/70")}>
      <td className="px-5 py-4 font-medium text-gray-800">Lane {lane.laneNumber}</td>
      <td className={clsx("px-5 py-4", isAtLimit ? "text-amber-700 font-medium" : "text-gray-700")}>
        {lane.today.accepted} / {lane.today.limit}
        {isAtLimit && <span className="block text-xs font-normal">Limit reached</span>}
      </td>
      <td className="px-5 py-4 text-xs text-gray-500">{formatDateTime(lane.credentialLastUsedAt)}</td>
      <td className="px-5 py-4">
        <button
          onClick={() => onSetActive(!lane.active)}
          disabled={saving}
          className={clsx(
            "rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50",
            lane.active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          )}
        >
          {lane.active ? "Active" : "Inactive"}
        </button>
      </td>
      <td className="px-5 py-4">
        {lane.credentialId ? (
          <div className="space-y-1">
            <span className="block text-xs font-medium text-green-700">Active</span>
            <span className="block text-xs text-gray-400">Last used {formatDateTime(lane.credentialLastUsedAt)}</span>
          </div>
        ) : <span className="text-xs text-gray-500">Not issued</span>}
      </td>
      <td className="px-5 py-4">
        <div className="flex flex-wrap gap-2 justify-end">
          <label className="sr-only" htmlFor={`lane-${lane.id}-limit`}>Lane {lane.laneNumber} daily limit</label>
          <input
            id={`lane-${lane.id}-limit`}
            aria-label={`Lane ${lane.laneNumber} daily accepted-CEC limit`}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            onBlur={saveLimit}
            onKeyDown={(event) => { if (event.key === "Enter") saveLimit(); }}
            type="number"
            min="1"
            inputMode="numeric"
            className="w-16 rounded border border-gray-300 px-2 py-1 text-xs"
            title="Daily accepted-CEC limit"
          />
          {lane.credentialId ? (
            <>
              <button onClick={onRotate} disabled={saving} className="text-xs text-blue-600 hover:underline disabled:opacity-50">Rotate key</button>
              <button onClick={onRevoke} disabled={saving} className="text-xs text-red-600 hover:underline disabled:opacity-50">Revoke</button>
            </>
          ) : (
            <button onClick={onIssue} disabled={saving} className="text-xs text-blue-600 hover:underline disabled:opacity-50">Issue key</button>
          )}
        </div>
      </td>
    </tr>
  );
}

function CredentialDialog({ laneNumber, apiKey, onClose }: { laneNumber: number; apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="credential-title">
      <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl space-y-4">
        <div>
          <h2 id="credential-title" className="font-bold text-gray-800">Lane {laneNumber} desktop credential</h2>
          <p className="mt-1 text-sm text-amber-800">Copy this key now. It will not be shown again.</p>
        </div>
        <code className="block break-all rounded-lg bg-gray-100 p-3 text-xs text-gray-800 select-all">{apiKey}</code>
        <div className="flex justify-end gap-3">
          <button onClick={copy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {copied ? "Copied" : "Copy key"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">I saved it</button>
        </div>
      </div>
    </div>
  );
}
