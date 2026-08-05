import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import axios from "axios";

interface DailyStat { date: string; total: number; passed: number; }
interface FuelSplit  { fuelType: string; count: number; }
interface Summary    { testsThisMonth: number; passRate: number; pendingLtms: number; }

const FUEL_COLORS: Record<string, string> = { GAS: "#3b82f6", DIESEL: "#f59e0b" };

async function fetchSidecar<T>(path: string): Promise<T> {
  const base = await window.petcBridge.getSidecarUrl();
  const { data } = await axios.get<T>(`${base}${path}`);
  return data;
}

export default function AnalyticsPage() {
  const { data: summary }   = useQuery({ queryKey: ["analytics", "summary"],    queryFn: () => fetchSidecar<Summary>("/analytics/summary"),         staleTime: 30_000 });
  const { data: daily = [] } = useQuery({ queryKey: ["analytics", "daily"],    queryFn: () => fetchSidecar<DailyStat[]>("/analytics/daily?days=7"), staleTime: 60_000 });
  const { data: fuel = [] }  = useQuery({ queryKey: ["analytics", "fuel"],     queryFn: () => fetchSidecar<FuelSplit[]>("/analytics/fuel-split"),   staleTime: 60_000 });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Analytics</h1>

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Tests This Month", value: summary.testsThisMonth },
            { label: "Pass Rate",    value: `${(summary.passRate * 100).toFixed(1)}%` },
            { label: "Pending LTMS", value: summary.pendingLtms },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl shadow p-5">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-3xl font-bold text-gray-800 mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-xl shadow p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Tests — Last 7 Days</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="passed" name="Passed" fill="#22c55e" radius={[3,3,0,0]} />
              <Bar dataKey="total"  name="Total"  fill="#e5e7eb" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Fuel Split</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={fuel} dataKey="count" nameKey="fuelType" cx="50%" cy="50%" outerRadius={75}
                   label={({ fuelType, percent }) => `${fuelType} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                {fuel.map((e) => <Cell key={e.fuelType} fill={FUEL_COLORS[e.fuelType] ?? "#6b7280"} />)}
              </Pie>
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
