import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { api } from "../../api/webClient";
import { formatCentavos, formatDateTime } from "../../utils/money";

interface Submission {
  id: string;
  test_id: string;
  center_id: string;
  center_name: string;
  state: string;
  attempts: number;
  certificate_no: string | null;
  or_no: string | null;
  rejection_reason: string | null;
  created_at: string;
  accepted_at: string | null;
  blocked_at: string | null;
  grace_released_at: string | null;
  acceptance_seq: number;
}

interface LedgerEntry {
  entry_type: string;
  amount_centavos: number;
  balance_after: number;
  acceptance_seq: number | null;
  created_by: string;
  note: string | null;
  created_at: string;
}

interface SubmissionDetail extends Submission {
  tenant_id: string;
  payload: string;
  ltms_ref_no: string | null;
  dermalog_token: string | null;
  valid_from: string | null;
  valid_until: string | null;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  ledger: LedgerEntry[];
}

const STATES = ["", "PENDING", "IN_FLIGHT", "ACCEPTED", "REJECTED", "BLOCKED", "DEAD"];

const STATE_STYLES: Record<string, string> = {
  ACCEPTED: "bg-green-100 text-green-700",
  PENDING: "bg-blue-100 text-blue-700",
  IN_FLIGHT: "bg-blue-100 text-blue-700",
  BLOCKED: "bg-amber-100 text-amber-800",
  REJECTED: "bg-red-100 text-red-700",
  DEAD: "bg-gray-200 text-gray-700",
};

function StateBadge({ state }: { state: string }) {
  return (
    <span className={clsx(
      "rounded-full px-2 py-0.5 text-xs font-medium",
      STATE_STYLES[state] ?? "bg-gray-100 text-gray-600"
    )}>
      {state}
    </span>
  );
}

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery<SubmissionDetail>({
    queryKey: ["submission", id],
    queryFn: () => api.get<SubmissionDetail>(`/admin/submissions/${id}`).then((r) => r.data),
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full max-w-xl h-full overflow-y-auto p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-gray-800">{data?.test_id ?? "…"}</h2>
            <p className="text-xs text-gray-500">{data?.center_name}</p>
          </div>
          <button onClick={onClose} className="text-xs text-gray-500 underline">Close</button>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="State"><StateBadge state={data.state} /></Field>
              <Field label="Attempts">{data.attempts}</Field>
              <Field label="Certificate">{data.certificate_no ?? "—"}</Field>
              <Field label="OR No.">{data.or_no ?? "—"}</Field>
              <Field label="Created">{formatDateTime(data.created_at)}</Field>
              <Field label="Accepted">{formatDateTime(data.accepted_at)}</Field>
              <Field label="Valid from">{data.valid_from ?? "—"}</Field>
              <Field label="Valid until">{data.valid_until ?? "—"}</Field>
            </div>

            {data.state === "BLOCKED" && (
              <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-xs text-amber-800">
                Held since {formatDateTime(data.blocked_at)} — the center's wallet cannot cover this
                filing. It dispatches automatically on top-up, or on grace expiry.
              </div>
            )}

            {data.grace_released_at && (
              <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-xs text-amber-800">
                Force-released on grace at {formatDateTime(data.grace_released_at)} — filed despite
                insufficient funds so the center stayed compliant.
              </div>
            )}

            {data.rejection_reason && (
              <div className="rounded-lg bg-red-50 border border-red-300 p-3 text-xs text-red-800">
                <span className="font-semibold">Rejected:</span> {data.rejection_reason}
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase mb-2">Wallet activity</h3>
              {data.ledger.length === 0 ? (
                <p className="text-xs text-gray-400">No charges — this submission was never accepted.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {data.ledger.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1.5">{l.entry_type}</td>
                        <td className="py-1.5 text-gray-500">#{l.acceptance_seq}</td>
                        <td className="py-1.5 text-right font-medium text-red-600">
                          {formatCentavos(l.amount_centavos)}
                        </td>
                        <td className="py-1.5 text-right text-gray-500">
                          {formatCentavos(l.balance_after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase mb-2">Payload</h3>
              <pre className="bg-gray-50 rounded-lg p-3 text-xs overflow-x-auto max-h-72">
                {JSON.stringify(JSON.parse(data.payload), null, 2)}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium text-gray-800">{children}</p>
    </div>
  );
}

export default function SubmissionsPage() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);

  const state = params.get("state") ?? "";
  const centerId = params.get("centerId") ?? "";

  const { data: submissions = [] } = useQuery<Submission[]>({
    queryKey: ["submissions", state, centerId],
    queryFn: () => {
      const q = new URLSearchParams();
      if (state) q.set("state", state);
      if (centerId) q.set("centerId", centerId);
      q.set("limit", "100");
      return api.get<Submission[]>(`/admin/submissions?${q}`).then((r) => r.data);
    },
    refetchInterval: 15_000,
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Submissions</h1>

      <div className="bg-white rounded-xl shadow p-4 flex gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
          <select
            value={state}
            onChange={(e) => setFilter("state", e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {STATES.map((s) => <option key={s} value={s}>{s || "All states"}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Center slug</label>
          <input
            value={centerId}
            onChange={(e) => setFilter("centerId", e.target.value)}
            placeholder="makati-etc"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <span className="ml-auto text-xs text-gray-500">{submissions.length} shown</span>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {["Test", "Center", "State", "Certificate", "Created", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {submissions.map((s) => (
              <tr key={s.id} className={clsx("hover:bg-gray-50", s.state === "BLOCKED" && "bg-amber-50/40")}>
                <td className="px-5 py-3 font-medium">{s.test_id}</td>
                <td className="px-5 py-3 text-gray-600">{s.center_name}</td>
                <td className="px-5 py-3">
                  <StateBadge state={s.state} />
                  {s.grace_released_at && (
                    <span className="ml-1 text-xs text-amber-700" title="Force-released on grace">⚑</span>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-500">{s.certificate_no ?? "—"}</td>
                <td className="px-5 py-3 text-gray-500">{formatDateTime(s.created_at)}</td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => setSelected(s.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
            {submissions.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                No submissions match these filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <DetailPanel id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
