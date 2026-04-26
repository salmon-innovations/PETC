import { useQuery } from "@tanstack/react-query";
import { sidecarClient } from "../../api/sidecarClient";

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
