import { motion } from "framer-motion";
import { StopCircle, Play, CheckCircle, WarningCircle, CircleNotch, Flask, Check, Gauge } from "@phosphor-icons/react";

export interface GasReadingsData {
  co_pct?: number | null;
  coPct?: number | null;
  hc_ppm?: number | null;
  hcPpm?: number | null;
  co2_pct?: number | null;
  co2Pct?: number | null;
  o2_pct?: number | null;
  o2Pct?: number | null;
  lambda_value?: number | null;
  lambdaValue?: number | null;
  no_ppm?: number | null;
  noPpm?: number | null;
  rpm?: number | null;
  oil_temp_c?: number | null;
  oilTempC?: number | null;
}

export interface GasLivePanelProps {
  running: boolean;
  readings?: GasReadingsData | null;
  photoCaptured?: boolean;
  queuedForLtms?: boolean;
  error?: string;
  source?: string;
  simulated?: boolean;
  onStart?: () => void;
  onStopMachine: () => void;
  disabled?: boolean;
  statusMessage?: string;
}

function formatValue(
  val: number | null | undefined,
  decimals = 2,
  isInteger = false,
): string {
  if (val == null || isNaN(val)) return "-";
  if (isInteger) return String(Math.round(val));
  return Number(val).toFixed(decimals);
}

export function GasLivePanel({
  running,
  readings,
  photoCaptured = false,
  queuedForLtms = false,
  error = "",
  source = "",
  simulated = false,
  onStart,
  onStopMachine,
  disabled = false,
  statusMessage,
}: GasLivePanelProps) {
  // Extract reading fields with fallbacks for snake_case and camelCase
  const co = readings?.co_pct ?? readings?.coPct;
  const hc = readings?.hc_ppm ?? readings?.hcPpm;
  const co2 = readings?.co2_pct ?? readings?.co2Pct;
  const o2 = readings?.o2_pct ?? readings?.o2Pct;
  const lambda = readings?.lambda_value ?? readings?.lambdaValue;
  const no = readings?.no_ppm ?? readings?.noPpm;
  const rpm = readings?.rpm;
  const oilTemp = readings?.oil_temp_c ?? readings?.oilTempC;

  const hasAnyReading =
    readings != null &&
    (co != null || hc != null || co2 != null || o2 != null || lambda != null || rpm != null);

  const displayStatus = error || statusMessage || (running
    ? "Sampling exhaust emissions from gas analyzer..."
    : hasAnyReading
      ? "Gas reading complete."
      : "Ready. Ensure sampling probe is inserted into exhaust pipe.");
  const parameters = [
    { label: "CO PCT", value: co, decimals: 2, unit: "% vol" },
    { label: "HC PPM", value: hc, decimals: 0, unit: "ppm" },
    { label: "LAMBDA VALUE", value: lambda, decimals: 3, unit: "ratio" },
    { label: "RPM", value: rpm, decimals: 0, unit: "rev/min" },
    { label: "CO2 PCT", value: co2, decimals: 1, unit: "% vol" },
    { label: "O2 PCT", value: o2, decimals: 1, unit: "% vol" },
    { label: "NO PPM", value: no, decimals: 0, unit: "ppm" },
    { label: "OIL TEMP C", value: oilTemp, decimals: 1, unit: "°C" },
  ];
  const renderValue = (parameter: typeof parameters[number]) =>
    running && parameter.value == null
      ? <span aria-label="Waiting for reading" className="inline-block w-14 h-7 rounded-lg bg-slate-800 animate-pulse" />
      : formatValue(parameter.value, parameter.decimals, parameter.decimals === 0);

  return (
    <section className="overflow-hidden rounded-3xl bg-[#0b1329] text-white shadow-2xl border border-slate-800/90" aria-label="Gas live readings">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 px-7 py-5">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-inner">
            <Gauge size={26} weight="bold" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-wide">GAS LIVE READINGS</h2>
            <span className="sr-only">READING</span>
            <p className="text-sm text-slate-400 font-medium">{source}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {simulated ? (
            <span className="flex items-center gap-2 rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-300">
              <Flask size={16} weight="fill" /> SIMULATION MODE
              <span className="sr-only">SIMULATION</span>
            </span>
          ) : running ? (
            <span className="rounded-xl border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300 animate-pulse">SAMPLING</span>
          ) : null}
          <span className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-semibold text-slate-300">GAS</span>
          {simulated && <span className="text-xs text-slate-400 font-medium">Mock analyzer selected.</span>}
        </div>
      </header>

      <div className="space-y-5 p-7">
        <div className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 ${error
          ? "bg-red-950/40 border-red-500/40 text-red-200"
          : running ? "bg-blue-950/40 border-blue-500/40 text-blue-200"
          : hasAnyReading ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
          : "bg-amber-950/20 border-amber-600/40 text-amber-200"}`}>
          <div className="flex items-center gap-3">
            {error ? <WarningCircle size={22} weight="fill" /> : running ? <CircleNotch size={22} className="animate-spin" /> : <CheckCircle size={22} weight="fill" />}
            <p role="status" className="text-base font-bold">{displayStatus}</p>
          </div>
          <p className="text-xs text-slate-400 font-medium">{error ? "Resolve analyzer connection before proceeding." : "Engine should be idling at regular operating temperature."}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {parameters.slice(0, 4).map(parameter => (
            <motion.div key={parameter.label} whileHover={{ y: -3 }} className="rounded-2xl bg-[#10192e] border border-slate-800/90 p-6 shadow-inner">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-extrabold text-blue-400 tracking-wider">{parameter.label}</span>
                <span className="text-slate-400 font-semibold">{parameter.unit}</span>
              </div>
              <p className="my-3 font-mono text-4xl font-black tabular-nums tracking-tight">{renderValue(parameter)}</p>
            </motion.div>
          ))}
        </div>

        <div className="rounded-2xl bg-[#10192e] border border-slate-800/90 p-6">
          <h3 className="border-b border-slate-800 pb-3.5 text-sm font-extrabold tracking-wider text-slate-200">EXHAUST GAS READINGS</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
            {parameters.map(parameter => (
              <div key={parameter.label} className="flex items-center justify-between border-b border-slate-800/80 py-3.5">
                <span className="text-sm font-semibold text-slate-400">{parameter.label}</span>
                <span className="font-mono text-xl font-black tabular-nums">{renderValue(parameter)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-[#10192e] border border-slate-800/90 p-6 space-y-2.5">
          <h3 className="text-sm font-extrabold tracking-wider text-slate-200">GAS TEST STATUS</h3>
          <p className="text-sm text-slate-300 font-medium">{hasAnyReading ? "Gas emission readings successfully received." : "Waiting for analyzer measurements."}</p>
          {photoCaptured ? <p className="flex items-center gap-2 text-sm text-emerald-300 font-bold"><Check size={16} weight="bold" /><span>Photo captured</span></p> : <p className="text-xs text-slate-400">Vehicle photo verification required following gas measurement.</p>}
          {queuedForLtms && <p className="text-sm text-slate-200 font-medium">Test queued for LTMS upload. Open the <strong>LTMS Upload</strong> page.</p>}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {running && (
            <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={onStopMachine} className="flex items-center gap-2.5 rounded-2xl bg-red-600 hover:bg-red-500 px-7 py-3 text-sm font-black cursor-pointer shadow-lg min-h-[44px]">
              <StopCircle size={20} weight="fill" /> <span>Stop Machine</span>
            </motion.button>
          )}
          {!running && onStart && (
            <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={onStart} disabled={disabled} className="flex items-center gap-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 px-8 py-3 text-sm font-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg min-h-[44px]">
              <Play size={18} weight="fill" /> <span>Perform Test</span>
            </motion.button>
          )}
        </div>
      </div>
    </section>
  );
}
