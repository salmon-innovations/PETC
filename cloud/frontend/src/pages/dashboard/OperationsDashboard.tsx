import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { api } from "../../api/webClient";
import { formatCentavos, formatDateTime } from "../../utils/money";

interface CenterAttention {
  tenant_id: string;
  slug: string;
  name: string;
  balance_centavos: number;
  blocked_count: number;
  belowDebtFloor: boolean;
  negative: boolean;
}

interface TopUp {
  tenant_id: string;
  center_name: string;
  amount_centavos: number;
  balance_after: number;
  created_by: string;
  note: string | null;
  created_at: string;
}

interface Summary {
  submissionStates: Record<string, number>;
  submissionsToday: number;
  acceptedToday: number;
  graceReleasedCount: number;
  totalFloatCentavos: number;
  debtFloorCentavos: number;
  centersNeedingAttention: CenterAttention[];
  recentTopUps: TopUp[];
}

const STATE_STYLES: Record<string, string> = {
  ACCEPTED: "bg-green-100 text-green-700",
  PENDING: "bg-blue-100 text-blue-700",
  IN_FLIGHT: "bg-blue-100 text-blue-700",
  BLOCKED: "bg-amber-100 text-amber-800",
  REJECTED: "bg-red-100 text-red-700",
  DEAD: "bg-gray-200 text-gray-700",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={clsx(
        "mt-1 text-2xl font-semibold",
        tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-gray-800"
      )}>
        {value}
      </p>
    </div>
  );
}

export default function OperationsDashboard() {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get<Summary>("/dashboard/summary").then((r) => r.data),
    refetchInterval: 15_000,
  });

  if (isLoading || !data) {
    return <div className="max-w-6xl mx-auto p-6 text-sm text-gray-400">Loading…</div>;
  }

  const blocked = data.submissionStates.BLOCKED ?? 0;
  const stranded = data.centersNeedingAttention.filter((c) => c.belowDebtFloor);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Operations</h1>

      {/* Submissions held below the debt floor are NOT grace-released, so an
          already-performed emission test is stranded from LTMS until someone
          intervenes commercially. That needs to be impossible to miss. */}
      {stranded.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">
            {stranded.length} center{stranded.length > 1 ? "s are" : " is"} past the debt floor
          </p>
          <p className="mt-1 text-xs text-red-700">
            Held submissions for these centers will not be auto-released. Performed tests are not
            reaching LTMS until the balance is restored.
          </p>
          <ul className="mt-2 space-y-0.5">
            {stranded.map((c) => (
              <li key={c.tenant_id} className="text-xs text-red-800">
                <Link to={`/centers/${c.tenant_id}`} className="underline font-medium">{c.name}</Link>
                {" — "}{formatCentavos(c.balance_centavos)}, {c.blocked_count} held
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Uploads today" value={String(data.submissionsToday)} />
        <Stat label="Accepted today" value={String(data.acceptedToday)} />
        <Stat
          label="Held for funds"
          value={String(blocked)}
          tone={blocked > 0 ? "warn" : undefined}
        />
        <Stat label="Total float" value={formatCentavos(data.totalFloatCentavos)} />
      </div>

      {data.graceReleasedCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            {data.graceReleasedCount} submission{data.graceReleasedCount > 1 ? "s" : ""} force-released on grace
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Filed to LTMS despite insufficient funds to keep the center compliant. The balance went
            negative and is recovered on the next top-up.
          </p>
        </div>
      )}

      {/* Submission states */}
      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-sm text-gray-700 mb-3">Submission states</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.submissionStates).length === 0 && (
            <span className="text-xs text-gray-400">No submissions yet.</span>
          )}
          {Object.entries(data.submissionStates).map(([state, count]) => (
            <Link
              key={state}
              to={`/submissions?state=${state}`}
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium hover:opacity-80",
                STATE_STYLES[state] ?? "bg-gray-100 text-gray-600"
              )}
            >
              {state} · {count}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Centers needing attention */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <h2 className="font-semibold text-sm text-gray-700 px-5 py-3 border-b">
            Centers needing attention
          </h2>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {data.centersNeedingAttention.map((c) => (
                <tr key={c.tenant_id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link to={`/centers/${c.tenant_id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.blocked_count > 0 && (
                      <span className="ml-2 text-xs text-amber-700">{c.blocked_count} held</span>
                    )}
                  </td>
                  <td className={clsx(
                    "px-5 py-3 text-right font-medium",
                    c.negative ? "text-red-600" : "text-amber-600"
                  )}>
                    {formatCentavos(c.balance_centavos)}
                  </td>
                </tr>
              ))}
              {data.centersNeedingAttention.length === 0 && (
                <tr><td className="px-5 py-8 text-center text-gray-400 text-xs">
                  All centers funded.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Recent top-ups */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <h2 className="font-semibold text-sm text-gray-700 px-5 py-3 border-b">Recent top-ups</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {data.recentTopUps.map((t, i) => (
                <tr key={i}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{t.center_name}</div>
                    <div className="text-xs text-gray-500">
                      {formatDateTime(t.created_at)} · {t.created_by}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-green-700">
                    +{formatCentavos(t.amount_centavos)}
                  </td>
                </tr>
              ))}
              {data.recentTopUps.length === 0 && (
                <tr><td className="px-5 py-8 text-center text-gray-400 text-xs">
                  No top-ups recorded.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
