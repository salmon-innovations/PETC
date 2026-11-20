import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowsClockwise,
  Camera,
  CaretDown,
  CaretRight,
  CloudArrowUp,
  Cpu,
  FileArrowUp,
  FolderOpen,
  Gauge,
  Gear,
  HardDrives,
  Info,
  PlugsConnected,
  Printer,
  ShieldCheck,
  Sliders,
  CheckCircle,
} from "@phosphor-icons/react";
import { sidecarClient, type AnalyzerSettings, type AnalyzerType } from "../../api/sidecarClient";
import { triggerAlert } from "../../store/alertStore";

interface AnalyzerOption {
  value: AnalyzerType;
  label: string;
  category: "Mock" | "Brand";
  description: string;
}

const ANALYZER_TYPES: AnalyzerOption[] = [
  {
    value: "mock",
    label: "Mock Analyzer",
    category: "Mock",
    description: "Simulation mode with live demo readings and no hardware required.",
  },
  {
    value: "cartesykj",
    label: "CARTESYKJ",
    category: "Brand",
    description: "Uses MQ-550 for gas tests and MQY-200 for diesel tests based on Run Test fuel selection.",
  },
  {
    value: "koeng",
    label: "KOENG",
    category: "Brand",
    description: "Uses the KOENG gas or diesel adapter based on Run Test fuel selection.",
  },
  {
    value: "fofen",
    label: "FOFEN",
    category: "Brand",
    description: "Uses Fofen petrol gas analyzer for gas and FTY-100 opacimeter for diesel.",
  },
  {
    value: "generic_serial",
    label: "Generic Serial",
    category: "Brand",
    description: "Uses generic ASCII gas or binary diesel serial adapter based on Run Test fuel selection.",
  },
];
const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200];
const FIXED_9600_TYPES: AnalyzerType[] = ["cartesykj", "koeng"];
const SERIAL_NUMBER_TYPES: AnalyzerType[] = ["cartesykj", "koeng"];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: status, isFetching: statusRefreshing } = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: sidecarClient.getStatus,
    refetchInterval: 10_000,
  });
  const { data: analyzerSettings } = useQuery({
    queryKey: ["analyzer-settings"],
    queryFn: sidecarClient.getAnalyzerSettings,
  });

  const isMock = analyzerSettings?.type === "mock" || !analyzerSettings;
  const isAnalyzerReady = isMock || (status?.analyzerConnected ?? false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto text-slate-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200/90">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm flex-shrink-0">
            <Gear size={26} weight="bold" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Settings & Configuration</h1>
            <p className="text-sm text-slate-500 font-medium mt-0.5">
              Configure analyzer hardware, COM serial ports, commissioning, and system diagnostics.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-2.5 border border-slate-200/90 shadow-sm">
          <span
            className={`w-3 h-3 rounded-full flex-shrink-0 ${
              isAnalyzerReady ? "bg-emerald-500 animate-glow" : "bg-red-500"
            }`}
          />
          <span className="text-sm font-bold text-slate-700">
            {isMock ? "Simulation Mode Active" : isAnalyzerReady ? "Hardware Connected" : "Analyzer Disconnected"}
          </span>
          <button
            type="button"
            title="Refresh hardware status"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["sidecar-status"] });
              void queryClient.invalidateQueries({ queryKey: ["analyzer-settings"] });
            }}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <ArrowsClockwise size={16} weight="bold" className={statusRefreshing ? "animate-spin text-blue-600" : ""} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          <AnalyzerHardwareSection />
          <CameraHardwareSection />
          <CommissioningSection />
        </div>

        <div className="lg:col-span-4 space-y-6">
          <DiagnosticsCard status={status} isMock={isMock} isAnalyzerReady={isAnalyzerReady} />
          <DataPathCard />
        </div>
      </div>
    </motion.div>
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
      setSavedMsg(res.connected ? "Saved & connected successfully." : "Saved (analyzer offline). Check COM port connection.");
      if (res.connected) {
        triggerAlert.success("Hardware Connected", "Analyzer is online and ready for testing");
      } else {
        triggerAlert.edit("Settings Saved", "Hardware is currently offline on selected COM port");
      }
      queryClient.invalidateQueries({ queryKey: ["analyzer-settings"] });
      queryClient.invalidateQueries({ queryKey: ["sidecar-status"] });
    },
    onError: (err: unknown) => {
      const message = err && typeof err === "object" && "response" in err
        // @ts-expect-error axios error shape
        ? err.response?.data?.detail ?? String(err)
        : String(err);
      setSavedMsg(`Failed: ${message}`);
      triggerAlert.error("Configuration Error", message);
    },
  });

  if (form === null) {
    return (
      <Panel icon={<Cpu size={22} weight="fill" />} title="Analyzer Hardware" subtitle="Loading analyzer configuration...">
        <div className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
      </Panel>
    );
  }

  const selected = ANALYZER_TYPES.find((type) => type.value === form.type);
  const isSerial = form.type !== "mock";
  const isFixed9600 = FIXED_9600_TYPES.includes(form.type);
  const needsSerialNumber = SERIAL_NUMBER_TYPES.includes(form.type);

  return (
    <Panel
      icon={<Cpu size={24} weight="fill" />}
      title="Analyzer Hardware"
      subtitle="Select the active analyzer brand and configure COM port communication."
      action={
        <span
          className={`rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide border ${
            form.type === "mock"
              ? "bg-amber-50 text-amber-800 border-amber-300"
              : "bg-blue-50 text-blue-700 border-blue-300"
          }`}
        >
          {form.type === "mock" ? "Simulation" : "Hardware"}
        </span>
      }
    >
      <div className="space-y-5">
        <Field label="Analyzer Brand">
          <select
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[46px]"
            value={form.type}
            onChange={(e) => {
              const type = e.target.value as AnalyzerType;
              const typeChanged = type !== form.type;
              const fixed = FIXED_9600_TYPES.includes(type);
              setForm({
                ...form,
                type,
                baud: fixed ? 9600 : form.baud,
                dataBits: fixed ? 8 : form.dataBits,
                parity: fixed ? "N" : form.parity,
                stopBits: fixed ? 1 : form.stopBits,
                serialNo: typeChanged ? "" : form.serialNo,
              });
            }}
          >
            {ANALYZER_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          {selected && <p className="text-xs text-slate-500 mt-2 font-medium leading-relaxed">{selected.description}</p>}
        </Field>

        {isSerial ? (
          <>
            <Field label="COM Port">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
                <select
                  className="min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[46px]"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                >
                  {!ports?.some((p) => p.device === form.port) && form.port && (
                    <option value={form.port}>{form.port} (not detected)</option>
                  )}
                  {ports?.map((port) => (
                    <option key={port.device} value={port.device}>
                      {port.device}{port.description ? ` - ${port.description}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => refetchPorts()}
                  disabled={portsLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 min-h-[46px] cursor-pointer"
                >
                  <ArrowsClockwise size={16} weight="bold" className={portsLoading ? "animate-spin" : ""} />
                  <span>{portsLoading ? "Scanning…" : "Scan Ports"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => mutation.mutate(form)}
                  disabled={mutation.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 min-h-[46px] shadow-sm cursor-pointer"
                >
                  <PlugsConnected size={18} weight="bold" />
                  <span>{mutation.isPending ? "Connecting…" : "Connect"}</span>
                </button>
              </div>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Baud Rate">
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-800 disabled:bg-slate-100 disabled:text-slate-500 min-h-[46px]"
                  value={form.baud}
                  onChange={(e) => setForm({ ...form, baud: Number(e.target.value) })}
                  disabled={isFixed9600}
                >
                  {BAUD_OPTIONS.map((baud) => (
                    <option key={baud} value={baud}>{baud}</option>
                  ))}
                </select>
              </Field>

              {needsSerialNumber && (
                <Field label="Analyzer Serial Number">
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[46px]"
                    value={form.serialNo}
                    onChange={(e) => setForm({ ...form, serialNo: e.target.value })}
                    placeholder="From calibration tag"
                  />
                </Field>
              )}
            </div>

            {isFixed9600 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
                <Info size={18} weight="fill" className="mt-0.5 flex-shrink-0 text-blue-600" />
                <span className="font-medium">This model uses fixed 9600 baud, 8N1. Ensure all other serial apps are closed before connecting.</span>
              </div>
            )}

            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800 cursor-pointer pt-1"
              onClick={() => setAdvanced(!advanced)}
            >
              {advanced ? <CaretDown size={16} weight="bold" /> : <CaretRight size={16} weight="bold" />}
              <span>{advanced ? "Hide advanced serial parameters" : "Advanced serial parameters (Data bits, parity, stop bits)"}</span>
            </button>

            {advanced && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <Field label="Data Bits">
                  <select className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base bg-white" value={form.dataBits} onChange={(e) => setForm({ ...form, dataBits: Number(e.target.value) })}>
                    <option value={7}>7</option>
                    <option value={8}>8</option>
                  </select>
                </Field>
                <Field label="Parity">
                  <select className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base bg-white" value={form.parity} onChange={(e) => setForm({ ...form, parity: e.target.value as "N" | "E" | "O" })}>
                    <option value="N">None (N)</option>
                    <option value="E">Even (E)</option>
                    <option value="O">Odd (O)</option>
                  </select>
                </Field>
                <Field label="Stop Bits">
                  <select className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base bg-white" value={form.stopBits} onChange={(e) => setForm({ ...form, stopBits: Number(e.target.value) })}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </Field>
                <Field label="Device Address (hex)">
                  <input className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base font-mono bg-white" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="01" />
                </Field>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm font-medium text-amber-900">
            <Info size={20} weight="fill" className="flex-shrink-0 text-amber-600" />
            <span>Mock mode uses automated synthetic data for demonstrations. No serial port or hardware connection is needed.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
          <span className={`text-sm font-bold ${savedMsg?.startsWith("Failed") ? "text-red-600" : "text-emerald-700"}`}>
            {savedMsg ?? ""}
          </span>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(form)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 py-3.5 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-50 shadow-md cursor-pointer min-h-[48px]"
          >
            <PlugsConnected size={20} weight="bold" />
            <span>{mutation.isPending ? "Applying Configuration…" : "Save & Reconnect"}</span>
          </button>
        </div>
      </div>
    </Panel>
  );
}

function CameraHardwareSection() {
  return (
    <Panel icon={<Camera size={24} weight="fill" />} title="Camera Verification" subtitle="Camera access is used for automated license plate and vehicle photo capture.">
      <div className="space-y-3">
        <p className="text-base text-slate-600 font-medium leading-relaxed">
          Verify live camera targeting HUD on the Run Test page. Operating system camera permissions and preferred video devices persist automatically.
        </p>
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 w-fit">
          <CheckCircle size={16} weight="fill" />
          <span>Camera Service Active</span>
        </div>
      </div>
    </Panel>
  );
}

function CommissioningSection() {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Panel icon={<FileArrowUp size={24} weight="fill" />} title="Center Commissioning" subtitle="Import official center credentials and cryptographic keys.">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600 font-medium max-w-md">The testing workstation restarts automatically after importing a center property file.</p>
        <button
          type="button"
          onClick={async () => {
            const result = await window.petcBridge.importCommissioning();
            setMessage(result.message);
            triggerAlert.success("Commissioning Imported", result.message);
          }}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 min-h-[44px] cursor-pointer shadow-xs"
        >
          <FileArrowUp size={18} weight="bold" />
          <span>Import Commissioning File</span>
        </button>
      </div>
      {message && <p className="text-sm font-semibold text-slate-700 mt-2">{message}</p>}
    </Panel>
  );
}

function DiagnosticsCard({
  status,
  isMock,
  isAnalyzerReady,
}: {
  status: Awaited<ReturnType<typeof sidecarClient.getStatus>> | undefined;
  isMock: boolean;
  isAnalyzerReady: boolean;
}) {
  return (
    <Panel icon={<ShieldCheck size={24} weight="fill" />} title="System Diagnostics" subtitle="Real-time local sidecar status.">
      <div className="space-y-2 divide-y divide-slate-100">
        <DiagnosticRow label="Sidecar Agent" value={status?.agentVersion ?? "0.1.0"} icon={<HardDrives size={18} />} />
        <DiagnosticRow
          label="Emission Analyzer"
          value={isMock ? "Ready (Mock)" : status?.analyzerConnected ? "Connected" : "Offline"}
          icon={<Gauge size={18} />}
          ok={isAnalyzerReady}
        />
        <DiagnosticRow label="Thermal Printer" value={status?.printerStatus.online ? "Online" : "Offline"} icon={<Printer size={18} />} ok={status?.printerStatus.online} />
        <DiagnosticRow label="Thermal Paper" value={status?.printerStatus.paper_ok ? "Paper OK" : "Low / Empty"} icon={<Sliders size={18} />} ok={status?.printerStatus.paper_ok} />
        <DiagnosticRow label="Cloud Outbox" value={`${status?.cloudOutboxPending ?? 0} pending`} icon={<CloudArrowUp size={18} />} />
      </div>
    </Panel>
  );
}

function DataPathCard() {
  const { data: path } = useQuery({
    queryKey: ["userData"],
    queryFn: () => window.petcBridge.getUserDataPath(),
  });

  return (
    <Panel icon={<FolderOpen size={24} weight="fill" />} title="Storage & Logs" subtitle="Local cache and test records.">
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
        <code className="block text-xs font-mono text-slate-600 break-all select-all bg-white p-2.5 rounded-xl border border-slate-200">{path ?? "Loading directory path..."}</code>
        <button
          type="button"
          onClick={() => path && window.petcBridge.openPath(path)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-xs min-h-[40px]"
        >
          <FolderOpen size={16} weight="bold" />
          <span>Open Folder in Explorer</span>
        </button>
      </div>
    </Panel>
  );
}

function DiagnosticRow({ label, value, icon, ok }: { label: string; value: string; icon: ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3.5 first:pt-0 text-sm">
      <div className="flex items-center gap-2 text-slate-500 font-semibold">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2 text-right">
        {ok !== undefined && <span className={`w-2.5 h-2.5 rounded-full ${ok ? "bg-emerald-500 shadow-glow-emerald" : "bg-red-500"}`} />}
        <span className={`font-extrabold ${ok === false ? "text-red-600" : ok === true ? "text-emerald-700" : "text-slate-800"}`}>{value}</span>
      </div>
    </div>
  );
}

function Panel({ icon, title, subtitle, action, children }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-3xl shadow-sm border border-slate-200/90 p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700 flex-shrink-0 shadow-inner">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="font-black text-lg text-slate-900 tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 font-medium mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      {children}
    </label>
  );
}