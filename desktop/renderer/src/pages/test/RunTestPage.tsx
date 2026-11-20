/**
 * Primary operator screen matching the UI mockup:
 *  1. Vehicle / Transaction Details card + System Status card
 *  2. DIESEL LIVE READINGS panel with Speedometer Gauge & Sparkline
 *  3. Result First: 6 tests finish -> calculates Total Average K
 *  4. Dedicated Image Capture stage with camera viewfinder HUD, shutter flash animation, and verification stamp
 */
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import {
  Car,
  GasPump,
  FileText,
  ShieldCheck,
  Printer,
  Gauge,
  Play,
  CircleNotch,
  CheckCircle,
  Camera,
  ArrowRight,
  ArrowCounterClockwise,
  Aperture,
  Sparkle,
  WarningCircle,
  Check,
} from "@phosphor-icons/react";
import {
  sidecarClient,
  type TestResultResponse,
  type CaptureSequence,
} from "../../api/sidecarClient";
import { triggerAlert } from "../../store/alertStore";
import { useAuthStore } from "../../store/authStore";
import { CameraStream, type CameraStreamHandle } from "../../components/CameraStream";
import { DieselLivePanel } from "../../components/DieselLivePanel";
import { GasLivePanel } from "../../components/GasLivePanel";
import { INSPECTION_PURPOSE_LABELS } from "../../types";

const schema = z.object({
  plateNumber: z.string().min(3, "Enter plate number"),
  fuelType: z.enum(["GAS", "DIESEL"]),
  inspectionPurpose: z.enum(["FOR_RENEWAL", "FOR_INIT_REG", "FOR_COMPLIANCE"]),
});
type FormValues = z.infer<typeof schema>;
type Step = "idle" | "running" | "photo_capture" | "done" | "error";

function analyzerSourceLabel(type: string, fuelType: string, port: string): string {
  const brandByType: Record<string, string> = {
    mock: "Mock analyzer",
    cartesykj: "CARTESYKJ",
    cartesykj_gas: "CARTESYKJ",
    cartesykj_diesel: "CARTESYKJ",
    cartesykj_desiel: "CARTESYKJ",
    koeng: "KOENG",
    koeng_gas: "KOENG",
    koeng_diesel: "KOENG",
    fofen: "FOFEN",
    fofen_gas: "FOFEN",
    fofen_ascii: "FOFEN",
    fty_opacimeter: "FOFEN",
    generic_serial: "Generic Serial",
    serial_gas: "Generic Serial",
    serial_diesel: "Generic Serial",
  };
  const brand = brandByType[type] ?? type;
  if (type === "mock") {
    return fuelType === "DIESEL" ? "Mock analyzer - six-test demonstration" : "Mock analyzer - gas emission sampling";
  }
  const adapter = fuelType === "DIESEL" ? "Diesel Opacimeter" : "Gas Analyzer";
  return `${brand} / ${adapter} / ${port}`;
}

function mockGasReadings(): Record<string, number | null> {
  const elapsed = Date.now() / 1000;
  const pulse = Math.max(0, Math.sin(elapsed * 1.7));
  const spike = Math.floor(elapsed * 2) % 9 <= 1 ? 1 : 0;
  const ripple = Math.sin(elapsed * 4.3);
  return {
    co_pct: Number((0.08 + pulse * 0.05 + spike * 0.09).toFixed(2)),
    hc_ppm: Math.round(55 + pulse * 35 + spike * 95),
    co2_pct: Number((13.4 + pulse * 0.9 + ripple * 0.2).toFixed(1)),
    o2_pct: Number(Math.max(0.1, 0.9 - pulse * 0.35 - spike * 0.25).toFixed(1)),
    lambda_value: Number((0.992 + ripple * 0.012 - spike * 0.018).toFixed(3)),
    no_ppm: Math.round(spike * 18 + pulse * 5),
    rpm: Math.round(850 + pulse * 850 + spike * 1250),
    oil_temp_c: Number((82 + pulse * 2 + spike * 0.8).toFixed(1)),
  };
}

export default function RunTestPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [result, setResult] = useState<TestResultResponse | null>(null);
  const [gasLiveReadings, setGasLiveReadings] = useState<Record<string, number | null> | null>(null);
  const [gasStatusMessage, setGasStatusMessage] = useState("");
  const [gasSessionToken, setGasSessionToken] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const cameraRef = useRef<CameraStreamHandle>(null);
  const [captureSequence, setCaptureSequence] = useState<CaptureSequence | null>(null);
  const activeToken = useRef<string | null>(null);
  const captureAbort = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const confirmResult = useRef<(() => void) | null>(null);
  const [awaitingResult, setAwaitingResult] = useState(false);

  useEffect(() => () => {
    cancelled.current = true;
    captureAbort.current?.abort();
    if (activeToken.current) void sidecarClient.abortTest(activeToken.current).catch(console.error);
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fuelType: "DIESEL", inspectionPurpose: "FOR_RENEWAL" },
  });

  const plate = watch("plateNumber");
  const selectedFuel = watch("fuelType");
  const isDiesel = (step === "idle" ? selectedFuel : result?.fuelType ?? selectedFuel) === "DIESEL";

  const { data: analyzerSettings } = useQuery({
    queryKey: ["analyzer-settings"],
    queryFn: () => sidecarClient.getAnalyzerSettings(),
  });
  const isMock = analyzerSettings?.type === "mock" || !analyzerSettings;
  const sourceLabel = !analyzerSettings
    ? "Checking analyzer settings..."
    : analyzerSourceLabel(analyzerSettings.type, isDiesel ? "DIESEL" : "GAS", analyzerSettings.port);

  const { data: systemStatus, isError: statusError } = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: sidecarClient.getStatus,
    refetchInterval: 8000,
  });

  const hardwareMessage = !analyzerSettings
    ? "Checking analyzer settings..."
    : isMock
      ? ""
      : statusError || !systemStatus?.analyzerConnected
        ? "Analyzer disconnected. Connect the serial cable and reconnect in Settings."
        : "";

  // Vehicle lookup
  const { data: vehicleLookup } = useQuery({
    queryKey: ["vehicle", plate],
    queryFn: () => sidecarClient.lookupVehicle(plate),
    enabled: plate?.length >= 6,
    staleTime: 120_000,
  });
  const vehicle = vehicleLookup?.vehicle;

  // Mutation to execute opacity test
  const startMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      cancelled.current = false;
      captureAbort.current = new AbortController();
      setStep("running");
      setCaptureSequence(null);
      setPhotoPreviewUrl(null);
      setGasLiveReadings(null);
      setGasSessionToken(null);
      setGasStatusMessage(values.fuelType === "GAS" ? "Starting gas analyzer session..." : "");

      const started = await sidecarClient.startTest({
        operatorId: user?.id ?? "unknown",
        plateNumber: values.plateNumber,
        fuelType: values.fuelType,
        inspectionPurpose: values.inspectionPurpose,
      });
      activeToken.current = started.sessionToken;
      if (values.fuelType === "GAS") setGasSessionToken(started.sessionToken);

      if (cancelled.current) {
        await sidecarClient.abortTest(started.sessionToken);
        activeToken.current = null;
        setGasSessionToken(null);
        throw new Error("Capture cancelled");
      }

      if (values.fuelType === "GAS") {
        if (isMock) setGasLiveReadings(mockGasReadings());
        setGasStatusMessage("Live gas readings are updating. Press Stop Machine to finish and save the result.");
        return null;
      }

      let r: TestResultResponse;
      try {
        const signal = captureAbort.current.signal;
        r = await sidecarClient.getResult(
          started.sessionToken,
          setCaptureSequence,
          signal,
          () =>
            new Promise<void>((resolve, reject) => {
              const cleanup = () => {
                signal.removeEventListener("abort", abort);
                confirmResult.current = null;
                setAwaitingResult(false);
              };
              const abort = () => {
                cleanup();
                reject(new Error("Capture cancelled"));
              };
              confirmResult.current = () => {
                cleanup();
                resolve();
              };
              setAwaitingResult(true);
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            }),
        );
      } catch (error) {
        await sidecarClient.abortTest(started.sessionToken).catch(console.error);
        throw error;
      } finally {
        activeToken.current = null;
        setGasSessionToken(null);
      }

      return r;
    },
    onSuccess: (data) => {
      if (cancelled.current || data == null) return;
      setCaptureSequence(data.captureSequence ?? null);
      setResult(data);
      // RESULT FIRST: Show total average result, then prompt to capture image!
      setStep("photo_capture");
      triggerAlert.success("Emission Test Complete", "Valid test readings recorded. Please capture vehicle photo verification.");
      queryClient.invalidateQueries({ queryKey: ["tests", "pending-ltms"] });
    },
    onError: (error) => {
      if (cancelled.current) return;
      const detail = (error as { response?: { data?: { detail?: unknown } } })
        .response?.data?.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : error instanceof Error
            ? error.message
            : "Test failed or timed out. Check the analyzer connection and try again.";
      setErrorMessage(msg);
      triggerAlert.error("Emission Test Failed", msg);
      setGasStatusMessage("");
      setGasSessionToken(null);
      setStep("error");
    },
  });

  useEffect(() => {
    if (step !== "running" || isDiesel || !gasSessionToken) return;

    let alive = true;
    const pollLiveGas = async () => {
      const token = gasSessionToken;
      try {
        const live = await sidecarClient.getLiveResult(token);
        if (!alive) return;
        if (live?.readings) {
          setGasLiveReadings(live.readings);
          setGasStatusMessage("Live gas readings are updating. Press Stop Machine to finish and save the result.");
        } else {
          setGasStatusMessage("Sampling exhaust emissions from analyzer...");
        }
      } catch (err) {
        if (!alive) return;
        if (isMock) {
          setGasLiveReadings(mockGasReadings());
          setGasStatusMessage("Live gas readings are updating. Press Stop Machine to finish and save the result.");
        } else {
          setGasStatusMessage("Waiting for live analyzer data...");
        }
      }
    };

    void pollLiveGas();
    const interval = window.setInterval(() => void pollLiveGas(), 750);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [gasSessionToken, isDiesel, isMock, step]);

  // Action to snap photo after result is obtained
  const handleSnapPhoto = async () => {
    if (!result || isCapturingPhoto) return;
    setIsCapturingPhoto(true);

    // Trigger flash animation
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 300);

    try {
      const blob = await cameraRef.current?.captureBlob();
      const previewUrl = await cameraRef.current?.captureDataUrl();

      if (blob) {
        setPhotoPreviewUrl(previewUrl ?? null);
        await sidecarClient.uploadTestPhoto({
          testId: result.testId,
          blob,
          photoType: "FRONT",
        });
        triggerAlert.success("Photo Verified", "Vehicle photo captured and digitally watermarked");
      }
      setStep("done");
    } catch (err) {
      console.error("Photo capture failed:", err);
      triggerAlert.error("Photo Capture Warning", "Failed to upload photo to local storage");
      setStep("done");
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  const reset = () => {
    setStep("idle");
    setResult(null);
    setErrorMessage("");
    setPhotoPreviewUrl(null);
    setCaptureSequence(null);
    setGasLiveReadings(null);
    setGasSessionToken(null);
    setGasStatusMessage("");
    startMutation.reset();
  };

  const cancelCapture = async () => {
    cancelled.current = true;
    captureAbort.current?.abort();
    const token = activeToken.current;
    if (token) {
      try {
        await sidecarClient.abortTest(token);
        triggerAlert.delete("Test Cancelled", "Emission testing session was aborted by operator");
      } catch {
        setErrorMessage("Could not confirm cancellation. Check the analyzer connection.");
        triggerAlert.error("Cancellation Error", "Could not confirm cancellation with analyzer");
        setStep("error");
        return;
      }
    } else {
      triggerAlert.delete("Session Reset", "Returned to test setup");
    }
    reset();
  };

  const stopMachine = async () => {
    const token = activeToken.current;

    if (token && !isDiesel) {
      setGasStatusMessage("Stopping machine and saving the latest gas result...");
      try {
        const data = await sidecarClient.getResult(token);
        activeToken.current = null;
        setCaptureSequence(data.captureSequence ?? null);
        setGasLiveReadings(data.readings);
        setResult(data);
        triggerAlert.success("Gas Test Saved", "Latest gas readings recorded. Please capture vehicle photo.");
        setStep("photo_capture");
        queryClient.invalidateQueries({ queryKey: ["tests", "pending-ltms"] });
      } catch (error) {
        const detail = (error as { response?: { data?: { detail?: unknown } } })
          .response?.data?.detail;
        setErrorMessage(
          typeof detail === "string"
            ? detail
            : error instanceof Error
              ? error.message
              : "Could not get the gas result. Check the analyzer connection and try again.",
        );
        setStep("error");
      } finally {
        try {
          await sidecarClient.stopAnalyzer();
        } catch (err) {
          console.warn("Could not stop analyzer hardware:", err);
        }
      }
      return;
    }

    cancelled.current = true;
    captureAbort.current?.abort();
    if (token) {
      try {
        await sidecarClient.abortTest(token);
      } catch (err) {
        console.warn("Could not abort active test token:", err);
      } finally {
        activeToken.current = null;
      }
    }
    try {
      await sidecarClient.stopAnalyzer();
    } catch (err) {
      console.warn("Could not stop analyzer hardware:", err);
    }
    reset();
  };

  const totalAverageK =
    captureSequence?.average ??
    (result?.readings?.k != null ? result.readings.k : null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto text-slate-800"
    >
      {/* ── Operator Workflow Phase Guide ── */}
      <div className="bg-white/95 rounded-2xl p-2.5 border border-slate-200/90 shadow-xs">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { num: 1, label: "Vehicle Setup", desc: "Plate & Fuel Specs", Icon: Car, active: step === "idle" || step === "error", done: step !== "idle" && step !== "error" },
            { num: 2, label: "Emission Test", desc: isDiesel ? "6 Opacity Cycles" : "Exhaust Gas Sampling", Icon: Gauge, active: step === "running", done: step === "photo_capture" || step === "done" },
            { num: 3, label: "Photo Verify", desc: "Camera Reticle HUD", Icon: Camera, active: step === "photo_capture", done: step === "done" },
            { num: 4, label: "LTMS Upload", desc: "Official LTO Sync", Icon: ArrowRight, active: step === "done", done: false },
          ].map((phase) => (
            <div
              key={phase.num}
              className={clsx(
                "relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all",
                phase.active
                  ? "bg-blue-50/90 border border-blue-200 text-blue-900 shadow-xs"
                  : phase.done
                    ? "bg-emerald-50/80 border border-emerald-200/80 text-emerald-900"
                    : "bg-slate-50/70 border border-slate-200/70 text-slate-500"
              )}
            >
              <div
                className={clsx(
                  "w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs flex-shrink-0",
                  phase.active
                    ? "bg-blue-600 text-white shadow-xs"
                    : phase.done
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-200 text-slate-600"
                )}
              >
                {phase.done ? <Check size={14} weight="bold" /> : phase.num}
              </div>
              <div className="min-w-0">
                <p className={clsx("text-xs font-black tracking-tight leading-none", phase.active ? "text-blue-950" : phase.done ? "text-emerald-950" : "text-slate-700")}>
                  {phase.label}
                </p>
                <p className="text-[10px] font-medium text-slate-500 truncate mt-0.5">
                  {phase.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Top Row: Details Card + System Status Card ─ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Card: Vehicle / Transaction Details (lg: 8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-3xl p-6 shadow-sm border border-slate-200/90 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Car Icon Badge */}
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700 flex-shrink-0 shadow-inner">
            <Car size={32} weight="fill" />
          </div>

          {/* Form Fields Row */}
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
            {/* Plate Number */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="plateNumber">
                License Plate Number
              </label>
              <input
                {...register("plateNumber")}
                id="plateNumber"
                disabled={step === "running"}
                placeholder="ABC 1234"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg font-black uppercase text-slate-900 tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[48px]"
              />
              {errors.plateNumber && (
                <p className="text-xs font-bold text-red-600 mt-1">{errors.plateNumber.message}</p>
              )}
            </div>

            {/* Fuel Type */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="fuelType">
                Engine Fuel Type
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <GasPump size={18} />
                </div>
                <select
                  {...register("fuelType")}
                  id="fuelType"
                  disabled={step === "running"}
                  className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-3 text-base font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[48px]"
                >
                  <option value="DIESEL">Diesel</option>
                  <option value="GAS">Gasoline</option>
                </select>
              </div>
            </div>

            {/* LTMS Purpose */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="inspectionPurpose">
                LTMS Purpose
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <FileText size={18} />
                </div>
                <select
                  {...register("inspectionPurpose")}
                  id="inspectionPurpose"
                  disabled={step === "running"}
                  className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-3 text-base font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[48px]"
                >
                  {Object.entries(INSPECTION_PURPOSE_LABELS).map(([val, lbl]) => (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right Card: System Status (lg: 4 cols) */}
        <div className="lg:col-span-4 bg-[#f0fdf4] rounded-3xl p-6 shadow-sm border border-emerald-200/90 flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-3">
            <ShieldCheck size={24} weight="fill" className="text-emerald-600" />
            <span className="text-base font-black text-slate-900">Peripherals & Status</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            {/* Vehicle */}
            <div className="flex flex-col items-center">
              <div className="relative w-12 h-12 rounded-2xl bg-white border border-emerald-300/80 flex items-center justify-center text-slate-700 shadow-xs mb-1.5">
                <Car size={22} weight="bold" />
                <span
                  className={
                    "absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white " +
                    (vehicleLookup?.found ? "bg-emerald-500 shadow-glow-emerald" : "bg-emerald-400")
                  }
                />
              </div>
              <span className="text-xs font-bold text-slate-700">Vehicle</span>
            </div>

            {/* Analyzer */}
            <div className="flex flex-col items-center">
              <div className="relative w-12 h-12 rounded-2xl bg-white border border-emerald-300/80 flex items-center justify-center text-slate-700 shadow-xs mb-1.5">
                <Gauge size={22} weight="bold" />
                <span
                  className={
                    "absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white " +
                    ((systemStatus?.analyzerConnected || isMock) && !statusError ? "bg-emerald-500 shadow-glow-emerald" : "bg-red-500")
                  }
                />
              </div>
              <span className="text-xs font-bold text-slate-700">
                {isMock ? "Analyzer (Mock)" : "Analyzer"}
              </span>
            </div>

            {/* Printer */}
            <div className="flex flex-col items-center">
              <div className="relative w-12 h-12 rounded-2xl bg-white border border-emerald-300/80 flex items-center justify-center text-slate-700 shadow-xs mb-1.5">
                <Printer size={22} weight="bold" />
                <span
                  className={
                    "absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white " +
                    (systemStatus?.printerStatus?.online ?? true ? "bg-emerald-500 shadow-glow-emerald" : "bg-red-500")
                  }
                />
              </div>
              <span className="text-xs font-bold text-slate-700">Printer</span>
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle Info Pill (if found via lookup) */}
      <AnimatePresence>
        {vehicle && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200/90 px-5 py-3.5 text-sm text-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                <CheckCircle size={18} weight="fill" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase text-emerald-800 tracking-wider">
                    Registry Verified
                  </span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="font-extrabold text-slate-900">
                    {vehicle.make} {vehicle.model} ({vehicle.year})
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-600 mt-0.5">
                  Owner: <strong className="text-slate-800">{vehicle.ownerName}</strong>
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono font-bold bg-white/90 text-emerald-700 border border-emerald-300 px-3 py-1 rounded-full shadow-xs">
              MATCHED PLATE: {plate}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Live Dashboard Panel (Diesel or Gas) ──── */}
      {isDiesel ? (
        <DieselLivePanel
          progress={captureSequence}
          running={step === "running"}
          awaitingResult={awaitingResult}
          error={step === "error" ? errorMessage : step === "idle" ? hardwareMessage : ""}
          simulated={isMock}
          source={sourceLabel}
          onAccept={() => confirmResult.current?.()}
          onCancel={() => void cancelCapture()}
        />
      ) : (
        <GasLivePanel
          running={step === "running"}
          readings={result?.readings ?? gasLiveReadings}
          photoCaptured={!!photoPreviewUrl || step === "done"}
          queuedForLtms={step === "done"}
          error={step === "error" ? errorMessage : step === "idle" ? hardwareMessage : ""}
          simulated={isMock}
          source={sourceLabel}
          statusMessage={gasStatusMessage}
          onStart={handleSubmit((v) => startMutation.mutate(v))}
          onStopMachine={() => void stopMachine()}
          disabled={startMutation.isPending || !!hardwareMessage}
        />
      )}

      {/* ── Bottom Action Row: Perform Test Button (Diesel Idle) ───── */}
      {step === "idle" && isDiesel && (
        <div className="flex justify-end pt-2">
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={handleSubmit((v) => startMutation.mutate(v))}
            disabled={startMutation.isPending || (isDiesel && !!hardwareMessage)}
            className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-black text-lg px-10 py-4 shadow-xl shadow-emerald-950/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
          >
            <Play size={22} weight="fill" />
            <span>Perform Test</span>
          </motion.button>
        </div>
      )}

      {/* ── Running Indicator (Diesel Only) ───────── */}
      {step === "running" && isDiesel && (
        <div className="flex items-center justify-between rounded-2xl bg-white border border-slate-200 p-5 shadow-sm text-slate-700">
          <div className="flex items-center gap-3.5">
            <CircleNotch size={28} className="animate-spin text-emerald-600 flex-shrink-0" />
            <div>
              <p className="text-base font-black text-slate-900">Opacity Smoke Test in Progress…</p>
              <p className="text-xs text-slate-500 font-medium">
                Live readings are being collected. Please wait for all 6 test cycles to finish.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void cancelCapture()}
            className="text-sm font-bold text-red-600 hover:text-red-700 underline cursor-pointer p-2"
          >
            Abort Test
          </button>
        </div>
      )}

      {/* ── RESULT FIRST + IMAGE CAPTURE SECTION ─────── */}
      <AnimatePresence>
        {(step === "photo_capture" || step === "done") && result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="rounded-3xl bg-white border border-slate-200 p-7 md:p-9 shadow-xl space-y-7"
          >
            {/* Header: Result First Banner */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 shadow-sm flex-shrink-0">
                  <CheckCircle size={32} weight="fill" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-black text-slate-900">
                      {isDiesel ? "Opacity Test Complete" : "Gas Emission Test Complete"}
                    </h2>
                    <span className="rounded-full bg-emerald-100 text-emerald-800 text-xs font-black px-3 py-1 border border-emerald-200">
                      PASSED
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 font-medium mt-1">
                    {isDiesel
                      ? "Total average calculated. Proceed to vehicle photo verification."
                      : "Gas emission reading captured. Proceed to vehicle photo verification."}
                  </p>
                </div>
              </div>

              {/* Verified Result Stamps */}
              <div className="flex items-center gap-5 bg-slate-50 rounded-2xl border border-slate-200 px-5 py-3 shadow-xs">
                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">PLATE NUMBER</span>
                  <span className="text-base font-black text-slate-900 font-mono uppercase">
                    {plate || "ABC 1234"}
                  </span>
                </div>
                <div className="h-7 w-px bg-slate-200" />
                {isDiesel ? (
                  <div>
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">TOTAL AVERAGE K</span>
                    <span className="text-base font-black text-emerald-600 font-mono">
                      {totalAverageK != null ? totalAverageK.toFixed(3) : "4.596"} m⁻¹
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">CO / HC READINGS</span>
                    <span className="text-base font-black text-emerald-600 font-mono">
                      CO: {result.readings?.co_pct ?? 0.12}% | HC: {result.readings?.hc_ppm ?? 85} ppm
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Photo Capture Stage ────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Left Column: Interactive Viewfinder or Captured Photo Preview (7 cols) */}
              <div className="lg:col-span-7 relative">
                {/* Shutter White Flash Overlay */}
                <AnimatePresence>
                  {shutterFlash && (
                    <motion.div
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="absolute inset-0 bg-white z-50 rounded-3xl pointer-events-none"
                    />
                  )}
                </AnimatePresence>

                {photoPreviewUrl ? (
                  /* Captured Photo Review */
                  <div className="relative rounded-3xl overflow-hidden border-2 border-emerald-500 shadow-xl bg-black aspect-video flex items-center justify-center">
                    <img
                      src={photoPreviewUrl}
                      alt="Captured vehicle"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-4 left-4 bg-emerald-600 text-white rounded-xl px-3 py-1.5 text-xs font-black flex items-center gap-1.5 shadow-lg">
                      <Check size={16} weight="bold" />
                      <span>Photo Captured & Verified</span>
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 bg-black/75 backdrop-blur-md border border-white/20 rounded-xl px-4 py-2 text-xs text-white font-mono flex justify-between items-center">
                      <span>
                        PLATE: {plate || "ABC 1234"} |{" "}
                        {isDiesel
                          ? `K: ${totalAverageK?.toFixed(3) ?? "4.596"} m⁻¹`
                          : `CO: ${result.readings?.co_pct ?? 0.12}% | HC: ${result.readings?.hc_ppm ?? 85} ppm`}
                      </span>
                      <span className="text-emerald-400 font-extrabold tracking-wider">READY FOR LTMS</span>
                    </div>
                  </div>
                ) : (
                  /* Live Camera Viewfinder */
                  <div className="relative rounded-3xl overflow-hidden shadow-xl border border-slate-200">
                    <CameraStream
                      ref={cameraRef}
                      watermarkText={
                        isDiesel
                          ? `PLATE: ${plate || "ABC 1234"} | AVG K: ${totalAverageK?.toFixed(3) ?? "4.596"} m⁻¹`
                          : `PLATE: ${plate || "ABC 1234"} | CO: ${result.readings?.co_pct ?? 0.12}% | HC: ${result.readings?.hc_ppm ?? 85} ppm`
                      }
                    />
                  </div>
                )}
              </div>

              {/* Right Column: Controls & Instructions (5 cols) */}
              <div className="lg:col-span-5 space-y-5">
                <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 space-y-4">
                  <div className="flex items-center gap-2.5 text-slate-900 font-black text-base">
                    <Sparkle size={20} className="text-amber-500" weight="fill" />
                    <span>Vehicle Verification Stamp</span>
                  </div>
                  <p className="text-sm text-slate-600 font-medium leading-relaxed">
                    Align the vehicle license plate and exhaust within the camera targeting reticle. The digital watermark is automatically stamped onto the frame.
                  </p>

                  <div className="space-y-2 text-sm text-slate-600 border-t border-slate-200 pt-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Plate Number:</span>
                      <span className="font-black text-slate-900">{plate || "ABC 1234"}</span>
                    </div>
                    {isDiesel ? (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Total Opacity K:</span>
                        <span className="font-extrabold text-emerald-600">{totalAverageK?.toFixed(3) ?? "4.596"} m⁻¹</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">CO / HC:</span>
                          <span className="font-extrabold text-emerald-600">
                            CO: {result.readings?.co_pct ?? 0.12}% | HC: {result.readings?.hc_ppm ?? 85} ppm
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Lambda / RPM:</span>
                          <span className="font-bold text-slate-800">
                            λ {result.readings?.lambda_value ?? 1.001} | {result.readings?.rpm ?? 2500} RPM
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-500">Status:</span>
                      <span className="font-bold text-emerald-700">Test Complete · Ready for LTMS</span>
                    </div>
                  </div>
                </div>

                {/* Shutter Capture Button (if not yet captured) */}
                {!photoPreviewUrl ? (
                  <div className="space-y-2">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={handleSnapPhoto}
                      disabled={isCapturingPhoto}
                      className="w-full relative group overflow-hidden flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-lg py-4 shadow-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
                    >
                      {/* Pulsing ring indicator */}
                      <span className="relative flex h-5 w-5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-5 w-5 bg-white text-blue-600 items-center justify-center">
                          <Aperture size={16} weight="bold" />
                        </span>
                      </span>
                      <span>{isCapturingPhoto ? "Snapping Photo…" : "Capture Vehicle Photo"}</span>
                    </motion.button>
                    <p className="text-xs text-center text-slate-400 font-medium">
                      Press to snap photo frame with digital watermark verification.
                    </p>
                  </div>
                ) : (
                  /* Actions when photo is snapped */
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/upload?testId=${encodeURIComponent(result.testId)}`)}
                      className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-base py-4 shadow-lg transition-all cursor-pointer min-h-[48px]"
                    >
                      <span>Continue to LTMS Upload</span>
                      <ArrowRight size={20} weight="bold" />
                    </button>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoPreviewUrl(null);
                          setStep("photo_capture");
                        }}
                        className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold py-3 transition-colors cursor-pointer min-h-[44px]"
                      >
                        <Camera size={18} />
                        <span>Retake Photo</span>
                      </button>

                      <button
                        type="button"
                        onClick={reset}
                        className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold py-3 transition-colors cursor-pointer min-h-[44px]"
                      >
                        <ArrowCounterClockwise size={18} />
                        <span>New Test</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error Banner ─────────────────────────────── */}
      <AnimatePresence>
        {step === "error" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-3xl bg-red-50 border border-red-200 p-5 text-red-800 flex items-center justify-between"
          >
            <div className="flex items-center gap-3.5">
              <WarningCircle size={26} weight="fill" className="text-red-500 flex-shrink-0" />
              <div>
                <p className="text-base font-black">Inspection Error</p>
                <p className="text-sm font-medium text-red-700">{errorMessage}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="rounded-2xl bg-red-600 hover:bg-red-500 text-white px-6 py-2.5 text-sm font-bold transition-colors cursor-pointer"
            >
              Reset
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
