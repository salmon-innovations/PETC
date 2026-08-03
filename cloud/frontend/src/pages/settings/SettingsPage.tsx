import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "../../api/webClient";
import CentersPage from "../admin/CentersPage";
import LicensesPage from "../../pages/licensing/LicensesPage";
import { formatCentavos, parsePesosToCentavos } from "../../utils/money";

interface Settings {
  "wallet.charge_per_upload_centavos": number;
  "wallet.low_balance_threshold_centavos": number;
  "wallet.grace_release_minutes": number;
  "wallet.debt_floor_centavos": number;
  "submission.max_attempts": number;
  "submission.backoff_seconds": number[];
}

const SECTIONS = [
  { id: "billing", label: "Billing Defaults" },
  { id: "retries", label: "Retry Policy" },
  { id: "centers", label: "Centers" },
  { id: "licenses", label: "API Keys" },
  { id: "users", label: "Users & Roles" },
  { id: "it", label: "IT Configuration" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b last:border-0">
      <div className="w-64 shrink-0">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-xl shadow p-8 text-center">
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="mt-2 text-xs text-gray-500 max-w-md mx-auto">{body}</p>
      <span className="inline-block mt-3 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
        Not yet available
      </span>
    </div>
  );
}

function BillingAndRetries({ section }: { section: "billing" | "retries" }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings").then((r) => r.data),
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      charge: String(data["wallet.charge_per_upload_centavos"] / 100),
      lowBalance: String(data["wallet.low_balance_threshold_centavos"] / 100),
      debtFloor: String(data["wallet.debt_floor_centavos"] / 100),
      grace: String(data["wallet.grace_release_minutes"]),
      maxAttempts: String(data["submission.max_attempts"]),
      backoff: data["submission.backoff_seconds"].join(", "),
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put("/settings", body).then((r) => r.data),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: (e: any) =>
      setError(e?.response?.data?.detail ?? "Save failed — check the values."),
  });

  const saveBilling = () => {
    const charge = parsePesosToCentavos(form.charge);
    const low = parsePesosToCentavos(form.lowBalance);
    const floor = parsePesosToCentavos(form.debtFloor);
    if (charge === null || low === null || floor === null) {
      setError("Amounts must be numbers.");
      return;
    }
    save.mutate({
      "wallet.charge_per_upload_centavos": charge,
      "wallet.low_balance_threshold_centavos": low,
      "wallet.debt_floor_centavos": floor,
      "wallet.grace_release_minutes": Number(form.grace),
    });
  };

  const saveRetries = () => {
    const backoff = form.backoff
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (backoff.length === 0) {
      setError("Backoff must be a comma-separated list of seconds.");
      return;
    }
    save.mutate({
      "submission.max_attempts": Number(form.maxAttempts),
      "submission.backoff_seconds": backoff,
    });
  };

  const input = (key: string, props: Record<string, unknown> = {}) => (
    <input
      value={form[key] ?? ""}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      {...props}
    />
  );

  return (
    <div className="bg-white rounded-xl shadow p-5">
      {section === "billing" ? (
        <>
          <Row label="Default charge per accepted CEC" hint="Used for new centers. Edit an existing center from its wallet page.">
            {input("charge", { inputMode: "decimal" })}
            <span className="ml-2 text-xs text-gray-500">
              {data && formatCentavos(data["wallet.charge_per_upload_centavos"])} currently
            </span>
          </Row>
          <Row label="Default low balance warning" hint="Used for new centers. Each center can override it from its wallet page.">
            {input("lowBalance", { inputMode: "decimal" })}
          </Row>
          <Row
            label="Debt floor"
            hint="Grace release STOPS below this. Held filings stay stranded from LTMS until paid — enter as a negative amount."
          >
            {input("debtFloor", { inputMode: "decimal" })}
          </Row>
          <Row
            label="Grace release window"
            hint="Minutes a held submission waits before being filed anyway, so billing cannot cause a DO 2023-008 breach."
          >
            {input("grace", { inputMode: "numeric" })}
            <span className="ml-2 text-xs text-gray-500">minutes</span>
          </Row>
          <button
            onClick={saveBilling}
            disabled={save.isPending}
            className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Save billing settings
          </button>
        </>
      ) : (
        <>
          <Row label="Max attempts" hint="Transport failures retried this many times before a submission is marked DEAD.">
            {input("maxAttempts", { inputMode: "numeric" })}
          </Row>
          <Row label="Backoff ladder" hint="Seconds between retries, comma-separated. The last value repeats.">
            <input
              value={form.backoff ?? ""}
              onChange={(e) => setForm({ ...form, backoff: e.target.value })}
              className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
            />
          </Row>
          <button
            onClick={saveRetries}
            disabled={save.isPending}
            className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Save retry policy
          </button>
        </>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {saved && <p className="mt-3 text-xs text-green-600">Saved.</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>("billing");

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Platform Settings</h1>

      <div className="flex gap-6">
        <nav className="w-48 shrink-0 space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={clsx(
                "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                section === s.id
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {(section === "billing" || section === "retries") && <BillingAndRetries section={section} />}
          {section === "centers" && <div className="-m-6"><CentersPage /></div>}
          {section === "licenses" && <div className="-m-6"><LicensesPage /></div>}
          {section === "users" && (
            <Placeholder
              title="Users & Roles"
              body="Center user management is not built yet. Roles exist in the schema but the portal has no
                    way to create users, and the role model needs work before per-role permissions are safe."
            />
          )}
          {section === "it" && (
            <Placeholder
              title="IT Configuration"
              body="LTMS endpoint and operational configuration will appear here. Credentials will stay in
                    environment variables rather than the database, so they are never reachable from a web session."
            />
          )}
        </div>
      </div>
    </div>
  );
}
