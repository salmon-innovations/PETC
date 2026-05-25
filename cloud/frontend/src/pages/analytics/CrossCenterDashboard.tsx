import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line,
} from "recharts";
import { api } from "../../api/webClient";

interface CenterSummary {
  centerName: string;
  totalTests: number;
  testsThisMonth: number;
  passRate: number;
  pendingLtms: number;
  acceptedLtms: number;
  rejectedLtms: number;
  lastSync: string | null;
}

interface DailyRollup {
  date: string;
  total: number;
  passed: number;
}

interface RecentEvent {
  receivedAt: string;
  centerName: string;
  centerId: string;
  entityType: string;
  entityId: string;
}

export default function CrossCenterDashboard() {
  const { data: centers = [] } = useQuery<CenterSummary[]>({
    queryKey: ["analytics", "centers"],
    queryFn: () => api.get<CenterSummary[]>("/analytics/centers").then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: daily = [] } = useQuery<DailyRollup[]>({
    queryKey: ["analytics", "cross-daily"],
    queryFn: () => api.get<DailyRollup[]>("/analytics/daily-rollup?days=14").then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: recentEvents = [] } = useQuery<RecentEvent[]>({
    queryKey: ["analytics", "recent-events"],
    queryFn: () => api.get<RecentEvent[]>("/analytics/recent-events?limit=12").then((r) => r.data),
    staleTime: 30_000,
  });

  const totalTests = centers.reduce((s, c) => s + c.testsThisMonth, 0);
  const totalMirrored = centers.reduce((s, c) => s + c.totalTests, 0);
  const avgPass = centers.length
    ? centers.reduce((s, c) => s + c.passRate, 0) / centers.length
    : 0;
  const totalPending = centers.reduce((s, c) => s + c.pendingLtms, 0);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Cross-Center Analytics</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Tests This Month", value: totalTests },
          { label: "Mirrored Tests",    value: totalMirrored },
          { label: "Avg Pass Rate",    value: `${(avgPass * 100).toFixed(1)}%` },
          { label: "Pending LTMS",     value: totalPending },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl shadow p-5">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Per-center bar chart */}
      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Tests by Center (This Month)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={centers} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="centerName" tick={{ fontSize: 11 }} width={120} />
            <Tooltip />
            <Bar dataKey="testsThisMonth" name="Tests" fill="#3b82f6" radius={[0,3,3,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Daily rollup line chart */}
      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily Tests — All Centers (14 days)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total"  name="Total"  stroke="#6b7280" dot={false} />
            <Line type="monotone" dataKey="passed" name="Passed" stroke="#22c55e" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-center sync status */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {["Center", "Total", "Tests (month)", "Pass Rate", "Accepted", "Rejected", "Pending LTMS", "Last Sync"].map((h) => (
                <th key={h} className="px-5 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {centers.map((c) => (
              <tr key={c.centerName} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium">{c.centerName}</td>
                <td className="px-5 py-3">{c.totalTests}</td>
                <td className="px-5 py-3">{c.testsThisMonth}</td>
                <td className="px-5 py-3">{(c.passRate * 100).toFixed(1)}%</td>
                <td className="px-5 py-3">{c.acceptedLtms}</td>
                <td className="px-5 py-3">{c.rejectedLtms}</td>
                <td className="px-5 py-3">{c.pendingLtms}</td>
                <td className="px-5 py-3 text-gray-500">
                  {c.lastSync ? new Date(c.lastSync).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold text-gray-700">Recent Mirror Events</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {["Time", "Center", "Event", "Entity"].map((h) => (
                <th key={h} className="px-5 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {recentEvents.map((event) => (
              <tr key={`${event.receivedAt}-${event.entityType}-${event.entityId}`} className="hover:bg-gray-50">
                <td className="px-5 py-3 text-gray-500">{new Date(event.receivedAt).toLocaleString()}</td>
                <td className="px-5 py-3 font-medium">{event.centerName}</td>
                <td className="px-5 py-3">{event.entityType}</td>
                <td className="px-5 py-3 font-mono text-xs text-gray-500">{event.entityId}</td>
              </tr>
            ))}
            {recentEvents.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-gray-500">No mirror events yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
