import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { sidecarClient, sidecarErrorMessage, type CommissioningValidation } from "../../api/sidecarClient";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../../store/authStore";

/** Shared first-run and administrator re-commissioning wizard. */
export default function CommissioningPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { data: status } = useQuery({ queryKey: ["sidecar-status"], queryFn: sidecarClient.getStatus });
  const [form, setForm] = useState({ cloudUrl: "", cloudKey: "", expectedCenter: "", expectedLane: "" });
  const [resolved, setResolved] = useState<CommissioningValidation | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const change = (name: keyof typeof form, value: string) => {
    setForm((old) => ({ ...old, [name]: value }));
    setResolved(null);
  };

  // An unconfigured installation must be commissionable before an operator
  // can sign in. Once configured, this becomes an administrator task reached
  // from Settings; the sidecar also requires its Electron-only capability.
  if (status?.configured && !status.commissioningRequired && !user) return <Navigate to="/login" replace />;
  if (status?.configured && !status.commissioningRequired && user && !["manager", "tenant_admin"].includes(user.role)) {
    return <div className="min-h-screen grid place-items-center text-sm text-gray-700">Cloud reconfiguration requires a PETC manager or tenant administrator.</div>;
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <section className="w-full max-w-2xl rounded-xl bg-white shadow p-7 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">PETC commissioning</h1>
          <p className="mt-1 text-sm text-gray-600">Connect this workstation to its issued cloud lane. Testing stays blocked until the identity, wallet, and daily quota are checked.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cloud URL"><input value={form.cloudUrl} onChange={(e) => change("cloudUrl", e.target.value)} placeholder="https://cloud.example.gov" autoComplete="url" /></Field>
          <Field label="Issued lane key"><input type="password" value={form.cloudKey} onChange={(e) => change("cloudKey", e.target.value)} placeholder="Issued lane key" autoComplete="new-password" /></Field>
          <Field label="Expected center"><input value={form.expectedCenter} onChange={(e) => change("expectedCenter", e.target.value)} placeholder="PETC-001" /></Field>
          <Field label="Expected lane number"><input inputMode="numeric" value={form.expectedLane} onChange={(e) => change("expectedLane", e.target.value)} placeholder="1" /></Field>
        </div>
        {error && <p className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="button" onClick={() => validate.mutate()} disabled={validate.isPending || !Object.values(form).every(Boolean)} className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {validate.isPending ? "Checking cloud…" : "Validate connection"}
        </button>
        {resolved && (
          <div className={resolved.identityValid ? "rounded border border-green-200 bg-green-50 p-4 text-sm" : "rounded border border-red-200 bg-red-50 p-4 text-sm"}>
            <p className="font-semibold">{resolved.identityValid ? "Credential identity resolved" : "Identity cannot be commissioned"}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
              <dt>Center</dt><dd>{resolved.centerName ?? resolved.centerId} ({resolved.centerId})</dd>
              <dt>Lane</dt><dd>{resolved.laneId} / #{resolved.laneNumber}</dd>
              <dt>Wallet</dt><dd>₱{(resolved.walletBalanceCentavos / 100).toFixed(2)}</dd>
              <dt>Quota</dt><dd>{resolved.quotaUsed} accepted, {resolved.quotaReserved} reserved, {resolved.quotaRemaining} remaining</dd>
            </dl>
            <p className="mt-3 text-xs">{resolved.reason}</p>
            {resolved.identityValid && (
              <div className="mt-4 border-t border-current/10 pt-3">
                <p className="text-xs mb-2">I confirm this is the intended PETC center and lane. Saving replaces this workstation’s cloud credential.</p>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {save.isPending ? "Saving…" : "Confirm and save commissioning"}
                </button>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-gray-500">The lane key is masked in diagnostics and is never displayed or written to logs. <Link className="underline" to="/login?diagnostics=1">Open diagnostics / sign in</Link></p>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700 space-y-1"><span>{label}</span>{children}</label>;
}
