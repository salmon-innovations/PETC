import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import clsx from "clsx";
import type { EmissionTest } from "../../types";

export default function HistoryPage() {
  const { data: tests = [], isLoading } = useQuery<EmissionTest[]>({
    queryKey: ["tests", "all"],
    queryFn: async () => {
      const base = await window.petcBridge.getSidecarUrl();
      const { data } = await axios.get(`${base}/tests?limit=100`);
      return data;
    },
    staleTime: 30_000,
  });

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <h1 className="text-xl font-bold text-gray-800">Test History</h1>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      <div className="bg-white rounded-xl shadow divide-y">
        {tests.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-semibold text-sm text-gray-800">{t.plateNumber}</p>
              <p className="text-xs text-gray-500">
                {t.fuelType} · {t.startedAt ? new Date(t.startedAt).toLocaleString() : "—"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {t.passFail !== null && (
                <span className={clsx(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  t.passFail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                )}>
                  {t.passFail ? "PASS" : "FAIL"}
                </span>
              )}
              <span className={clsx(
                "rounded-full px-2 py-0.5 text-xs",
                t.ltmsState === "ACCEPTED"
                  ? "bg-blue-100 text-blue-700"
                  : t.ltmsState === "REJECTED"
                  ? "bg-red-100 text-red-600"
                  : "bg-yellow-100 text-yellow-700"
              )}>
                {t.ltmsState ?? "pending LTMS"}
              </span>
            </div>
          </div>
        ))}
        {!isLoading && tests.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-gray-500">No tests recorded yet.</p>
        )}
      </div>
    </div>
  );
}
