import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { z } from "zod";
import clsx from "clsx";
import { api } from "../../api/webClient";
import { formatCentavos } from "../../utils/money";

interface CenterWallet {
  tenantId: string;
  balanceCentavos: number;
  low: boolean;
  negative: boolean;
  blockedCount: number;
  chargePerUploadCentavos: number;
  chargeOverrideCentavos: number | null;
}

interface Center {
  id: string;
  slug: string;
  name: string;
  activeLicenses: number;
  lastSync: string | null;
}

const addSchema = z.object({
  name: z.string().min(2, "Name required"),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, hyphens only"),
});
type AddForm = z.infer<typeof addSchema>;

export default function CentersPage() {
  const qc = useQueryClient();

  const { data: centers = [] } = useQuery<Center[]>({
    queryKey: ["centers"],
    queryFn: () => api.get<Center[]>("/tenants").then((r) => r.data),
  });

  const { data: wallets = [] } = useQuery<CenterWallet[]>({
    queryKey: ["wallet-centers"],
    queryFn: () => api.get<CenterWallet[]>("/wallet/centers").then((r) => r.data),
  });
  const walletByTenant = Object.fromEntries(wallets.map((w) => [w.tenantId, w]));

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<AddForm>({ resolver: zodResolver(addSchema) });

  const addMutation = useMutation({
    mutationFn: (data: AddForm) => api.post("/tenants", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["centers"] }); reset(); },
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Emission Testing Centers</h1>

      {/* Add center form */}
      <form
        onSubmit={handleSubmit((v) => addMutation.mutate(v))}
        className="bg-white rounded-xl shadow p-5 flex gap-4 items-end"
      >
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Center Name</label>
          <input {...register("name")} placeholder="Makati ETC" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          {errors.name && <p className="mt-0.5 text-xs text-red-600">{errors.name.message}</p>}
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Slug (URL key)</label>
          <input {...register("slug")} placeholder="makati-etc" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          {errors.slug && <p className="mt-0.5 text-xs text-red-600">{errors.slug.message}</p>}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Add Center
        </button>
      </form>

      {/* Centers table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {["Name", "Slug", "Price / CEC", "Balance", "Licenses", "Last Sync", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {centers.map((c) => {
              const w = walletByTenant[c.id];
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">
                    <Link to={`/centers/${c.id}`} className="hover:underline">{c.name}</Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-gray-500">{c.slug}</td>
                  <td className="px-5 py-3 text-gray-700">
                    {w ? formatCentavos(w.chargePerUploadCentavos) : "—"}
                    {w?.chargeOverrideCentavos !== null && w?.chargeOverrideCentavos !== undefined && (
                      <span className="block text-[10px] text-blue-600">custom</span>
                    )}
                  </td>
                  <td className={clsx(
                    "px-5 py-3 font-medium",
                    w?.negative ? "text-red-600" : w?.low ? "text-amber-600" : "text-gray-700"
                  )}>
                    {w ? formatCentavos(w.balanceCentavos) : "—"}
                    {w && w.blockedCount > 0 && (
                      <span className="ml-2 text-xs text-amber-700">{w.blockedCount} held</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{c.activeLicenses}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {c.lastSync ? new Date(c.lastSync).toLocaleString() : "Never"}
                  </td>
                  <td className="px-5 py-3">
                    <Link to={`/centers/${c.id}`} className="text-blue-600 hover:underline text-xs">
                      Wallet
                    </Link>
                  </td>
                </tr>
              );
            })}
            {centers.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No centers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
