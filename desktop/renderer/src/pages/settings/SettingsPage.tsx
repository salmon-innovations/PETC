import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sidecarClient, type AnalyzerSettings, type AnalyzerType } from "../../api/sidecarClient";

const ANALYZER_TYPES: { value: AnalyzerType; label: string }[] = [
  { value: "mock", label: "Mock (no hardware)" },
  { value: "serial_gas", label: "Gas analyzer — ASCII" },
  { value: "serial_diesel", label: "Diesel analyzer — Binary" },
  { value: "fty_opacimeter", label: "FTY-100 Opacimeter (FOFEN SINGLE)" },
  { value: "fofen_gas", label: "Fofen Petrol Gas Analyzer — binary push" },
  { value: "fofen_ascii", label: "Fofen Petrol Gas Analyzer — ASCII receipt (PRINT)" },
];

const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200];

export default function SettingsPage() {
  const { data: status } = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: sidecarClient.getStatus,
  });

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Settings</h1>

      <section className="bg-white rounded-xl shadow divide-y">
        <Row label="Agent Version"   value={status?.agentVersion ?? "—"} />
        <Row label="Analyzer"        value={status?.analyzerConnected ? "Connected" : "Offline"} ok={status?.analyzerConnected} />
        <Row label="Printer"         value={status?.printerStatus.online ? "Online" : "Offline"} ok={status?.printerStatus.online} />
        <Row label="Paper"           value={status?.printerStatus.paper_ok ? "OK" : "Low / empty"} ok={status?.printerStatus.paper_ok} />
        <Row label="Cloud sync queue" value={`${status?.cloudOutboxPending ?? "—"} pending`} />
      </section>

      <AnalyzerHardwareSection />

      <CameraHardwareSection />

      <section className="bg-white rounded-xl shadow p-5 space-y-2">
        <h2 className="font-semibold text-sm text-gray-700">Data Location</h2>
        <DataPath />
      </section>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={ok === false ? "text-red-600 font-medium" : ok === true ? "text-green-700 font-medium" : "text-gray-800"}>
        {value}
      </span>
    </div>
  );
}

function DataPath() {
  const { data: path } = useQuery({
    queryKey: ["userData"],
    queryFn: () => window.petcBridge.getUserDataPath(),
  });

  return (
    <div className="flex items-center justify-between gap-3">
      <code className="text-xs text-gray-500 truncate">{path ?? "…"}</code>
      <button
        onClick={() => path && window.petcBridge.openPath(path)}
        className="flex-shrink-0 rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
      >
        Open
      </button>
    </div>
  );
}

function AnalyzerHardwareSection() {
  const queryClient = useQueryClient();
  const { data: saved } = useQuery({
    queryKey: ["analyzer-settings"],
    queryFn: sidecarClient.getAnalyzerSettings,
  });
  const { data: ports, refetch: refetchPorts, isFetching: portsLoading } = useQuery({
    queryKey: ["serial-ports"],
    queryFn: sidecarClient.listSerialPorts,
  });

  const [form, setForm] = useState<AnalyzerSettings | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (saved && form === null) setForm(saved);
  }, [saved, form]);

  const mutation = useMutation({
    mutationFn: (payload: AnalyzerSettings) => sidecarClient.updateAnalyzerSettings(payload),
    onSuccess: (res) => {
      setSavedMsg(res.connected ? "Saved & connected." : "Saved (analyzer offline).");
      queryClient.invalidateQueries({ queryKey: ["analyzer-settings"] });
      queryClient.invalidateQueries({ queryKey: ["sidecar-status"] });
    },
    onError: (err: unknown) => {
      const message = err && typeof err === "object" && "response" in err
        // @ts-expect-error axios error shape
        ? err.response?.data?.detail ?? String(err)
        : String(err);
      setSavedMsg(`Failed: ${message}`);
    },
  });

  if (form === null) {
    return (
      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-sm text-gray-700">Analyzer Hardware</h2>
        <p className="text-xs text-gray-500 mt-2">Loading…</p>
      </section>
    );
  }

  const isSerial = form.type !== "mock";

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-4">
      <h2 className="font-semibold text-sm text-gray-700">Analyzer Hardware</h2>

      <Field label="Analyzer type">
        <select
          className="w-full border rounded px-2 py-1 text-sm"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as AnalyzerType })}
        >
          {ANALYZER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </Field>

      {isSerial && (
        <>
          <Field label="COM port">
            <div className="flex gap-2">
              <select
                className="flex-1 border rounded px-2 py-1 text-sm"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              >
                {!ports?.some((p) => p.device === form.port) && (
                  <option value={form.port}>{form.port} (not detected)</option>
                )}
                {ports?.map((p) => (
                  <option key={p.device} value={p.device}>
                    {p.device}{p.description ? ` — ${p.description}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => refetchPorts()}
                disabled={portsLoading}
                className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                {portsLoading ? "…" : "Refresh"}
              </button>
            </div>
          </Field>

          <Field label="Baud rate">
            <select
              className="w-full border rounded px-2 py-1 text-sm"
              value={form.baud}
              onChange={(e) => setForm({ ...form, baud: Number(e.target.value) })}
            >
              {BAUD_OPTIONS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </Field>

          <button
            type="button"
            className="text-xs text-blue-600 hover:underline"
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? "▾ Hide advanced" : "▸ Advanced (data bits / parity / stop bits / address)"}
          </button>

          {advanced && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Data bits">
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={form.dataBits}
                  onChange={(e) => setForm({ ...form, dataBits: Number(e.target.value) })}
                >
                  <option value={7}>7</option>
                  <option value={8}>8</option>
                </select>
              </Field>
              <Field label="Parity">
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={form.parity}
                  onChange={(e) => setForm({ ...form, parity: e.target.value as "N" | "E" | "O" })}
                >
                  <option value="N">None</option>
                  <option value="E">Even</option>
                  <option value="O">Odd</option>
                </select>
              </Field>
              <Field label="Stop bits">
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={form.stopBits}
                  onChange={(e) => setForm({ ...form, stopBits: Number(e.target.value) })}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </Field>
              <Field label="Device address (hex)">
                <input
                  className="w-full border rounded px-2 py-1 text-sm font-mono"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="01"
                />
              </Field>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between pt-2">
        <span className={`text-xs ${savedMsg?.startsWith("Failed") ? "text-red-600" : "text-green-700"}`}>
          {savedMsg ?? ""}
        </span>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(form)}
          className="rounded bg-blue-600 text-white px-4 py-1.5 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {mutation.isPending ? "Applying…" : "Save & reconnect"}
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function CameraHardwareSection() {
  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-2">
      <h2 className="font-semibold text-sm text-gray-700">Camera</h2>
      <p className="text-xs text-gray-600">
        The camera is managed by the app's built-in capture (the same way a website
        accesses your camera). Pick the camera and confirm the live preview on the{" "}
        <span className="font-medium">Run Test</span> page — selection persists.
      </p>
    </section>
  );
}
