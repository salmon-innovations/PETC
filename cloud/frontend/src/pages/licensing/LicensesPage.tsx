import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/webClient";
import clsx from "clsx";

interface License {
  id: string;
  centerName: string;
  tenantId: string;
  active: boolean;
  issuedAt: string;
  expiresAt: string | null;
}

interface NewLicenseResponse {
  id: string;
  rawKey: string;   // shown once, never stored in plain text again
}

export default function LicensesPage() {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState<NewLicenseResponse | null>(null);
  const [selectedTenant, setSelectedTenant] = useState("");

  const { data: licenses = [] } = useQuery<License[]>({
    queryKey: ["licenses"],
    queryFn: () => api.get<License[]>("/licenses").then((r) => r.data),
  });

  const { data: tenants = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["tenants-list"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/tenants").then((r) => r.data),
  });

  const issueMutation = useMutation({
    mutationFn: (tenantId: string) =>
      api.post<NewLicenseResponse>("/licenses", { tenantId }).then((r) => r.data),
    onSuccess: (data) => {
      setNewKey(data);
      qc.invalidateQueries({ queryKey: ["licenses"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/licenses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licenses"] }),
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">API Key Licenses</h1>

      {/* Issue new key */}
      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <h2 className="font-semibold text-sm text-gray-700">Issue New Key</h2>
        <div className="flex gap-3">
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select center…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            onClick={() => selectedTenant && issueMutation.mutate(selectedTenant)}
            disabled={!selectedTenant || issueMutation.isPending}
            className="rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Issue
          </button>
        </div>

        {newKey && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-300 p-4 space-y-1">
            <p className="text-xs font-semibold text-yellow-800">Copy this key now — it won't be shown again:</p>
            <code className="block text-sm font-mono text-yellow-900 break-all">{newKey.rawKey}</code>
            <button onClick={() => setNewKey(null)} className="text-xs text-yellow-700 underline mt-1">Dismiss</button>
          </div>
        )}
      </div>

      {/* Licenses table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {["Center", "Issued", "Expires", "Status", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {licenses.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium">{l.centerName}</td>
                <td className="px-5 py-3 text-gray-500">{new Date(l.issuedAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-gray-500">{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : "Never"}</td>
                <td className="px-5 py-3">
                  <span className={clsx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    l.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  )}>
                    {l.active ? "Active" : "Revoked"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {l.active && (
                    <button
                      onClick={() => revokeMutation.mutate(l.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {licenses.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400">No licenses issued.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
