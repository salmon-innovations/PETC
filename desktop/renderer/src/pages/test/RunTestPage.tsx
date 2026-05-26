/**
 * Primary operator screen:
 *  1. Enter plate → auto-lookup vehicle from LTMS (via sidecar gov endpoint)
 *  2. Start test  → sidecar instructs analyzer
 *  3. Poll result → readings displayed
 *  4. Capture photo
 *  5. Queue LTMS upload (CEC preview + print happens in the LTMS wizard)
 */
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { sidecarClient, type TestResultResponse } from "../../api/sidecarClient";
import { useAuthStore } from "../../store/authStore";
import { CameraStream, type CameraStreamHandle } from "../../components/CameraStream";

const schema = z.object({
  plateNumber: z.string().min(3, "Enter plate number"),
  fuelType: z.enum(["GAS", "DIESEL"]),
});
type FormValues = z.infer<typeof schema>;
type Step = "idle" | "running" | "done" | "error";

export default function RunTestPage() {
  const user = useAuthStore((s) => s.user);
  const [result, setResult] = useState<TestResultResponse | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [photoCaptured, setPhotoCaptured] = useState(false);
  const cameraRef = useRef<CameraStreamHandle>(null);

  const { register, handleSubmit, watch, formState: { errors } } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { fuelType: "GAS" } });

  const plate = watch("plateNumber");

  // Lookup vehicle info once plate is long enough
  const { data: vehicleLookup } = useQuery({
    queryKey: ["vehicle", plate],
    queryFn: () => sidecarClient.lookupVehicle(plate),
    enabled: plate?.length >= 6,
    staleTime: 120_000,
  });
  const vehicle = vehicleLookup?.vehicle;

  const startMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const started = await sidecarClient.startTest({
        operatorId: user?.id ?? "unknown",
        plateNumber: values.plateNumber,
        fuelType: values.fuelType,
      });
      setStep("running");
      const r = await sidecarClient.getResult(started.sessionToken);
      // Grab the current frame from the live preview and upload it
      try {
        const blob = await cameraRef.current?.captureBlob();
        if (!blob) {
          console.warn("Photo capture skipped: no live preview frame available");
        } else {
          await sidecarClient.uploadTestPhoto({ testId: r.testId, blob, photoType: "FRONT" });
          setPhotoCaptured(true);
        }
      } catch (err) {
        console.error("Photo upload failed:", err);
      }
      return r;
    },
    onSuccess: (data) => { setResult(data); setStep("done"); },
    onError: () => setStep("error"),
  });

  const reset = () => {
    setStep("idle");
    setResult(null);
    setPhotoCaptured(false);
    startMutation.reset();
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <h1 className="text-xl font-bold text-gray-800">Emission Test</h1>

      {/* Input form */}
      <form
        onSubmit={handleSubmit((v) => { setStep("idle"); setResult(null); startMutation.mutate(v); })}
        className="bg-white rounded-xl shadow p-6 space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Plate Number</label>
            <input
              {...register("plateNumber")}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ABC 1234"
            />
            {errors.plateNumber && <p className="mt-1 text-xs text-red-600">{errors.plateNumber.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Fuel Type</label>
            <select
              {...register("fuelType")}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="GAS">Gasoline</option>
              <option value="DIESEL">Diesel</option>
            </select>
          </div>
        </div>

        {vehicle && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
            <span className="font-semibold">{vehicle.make} {vehicle.model} ({vehicle.year})</span>
            {" — "}{vehicle.ownerName}
          </div>
        )}

        <CameraStream ref={cameraRef} />

        <button
          type="submit"
          disabled={step === "running"}
          className={clsx(
            "w-full rounded-lg py-2.5 text-white font-semibold transition-colors",
            step === "running" ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
          )}
        >
          {step === "running" ? "Analyzer running…" : "Start Test"}
        </button>
      </form>

      {/* Running indicator */}
      {step === "running" && (
        <div className="flex items-center justify-between gap-3 bg-white rounded-xl shadow px-5 py-4 text-gray-600">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <span className="text-sm">Waiting for analyzer result… press PRINT on the analyzer.</span>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-gray-500 hover:text-red-600 underline"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Result card */}
      {step === "done" && result && (
        <div className="rounded-xl shadow p-6 space-y-5 bg-white border border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800">
              READING
            </h2>
            <span className="rounded-full px-3 py-1 text-sm font-medium bg-gray-100 text-gray-700">
              {result.fuelType}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {Object.entries(result.readings).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-gray-200 pb-1">
                <span className="text-gray-500">{k.replace(/_/g, " ").toUpperCase()}</span>
                <span className="font-mono font-semibold">{v ?? "—"}</span>
              </div>
            ))}
          </div>

          {photoCaptured && (
            <div className="text-xs text-green-700">Photo captured ✓</div>
          )}

          <p className="text-xs text-gray-500">
            Test queued for LTMS upload. Open the <strong>LTMS Upload</strong> page to submit and print the CEC.
          </p>

          <div className="flex gap-3 pt-1">
            <button
              onClick={reset}
              className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              New Test
            </button>
          </div>
        </div>
      )}

      {step === "error" && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-800 flex items-center justify-between">
          <span>Test failed or timed out. Check the analyzer connection and try again.</span>
          <button
            type="button"
            onClick={reset}
            className="rounded bg-red-600 text-white px-3 py-1 text-xs hover:bg-red-700"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

