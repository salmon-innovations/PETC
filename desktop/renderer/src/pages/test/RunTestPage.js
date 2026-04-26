import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Primary operator screen:
 *  1. Enter plate → auto-lookup vehicle from LTMS (via sidecar gov endpoint)
 *  2. Start test  → sidecar instructs analyzer
 *  3. Poll result → readings displayed
 *  4. Capture photo
 *  5. Print receipt (×2)
 *  6. Queue LTMS upload
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { sidecarClient } from "../../api/sidecarClient";
import { useAuthStore } from "../../store/authStore";
const schema = z.object({
    plateNumber: z.string().min(3, "Enter plate number"),
    fuelType: z.enum(["GAS", "DIESEL"]),
});
export default function RunTestPage() {
    const user = useAuthStore((s) => s.user);
    const [result, setResult] = useState(null);
    const [step, setStep] = useState("idle");
    const [photoCaptured, setPhotoCaptured] = useState(false);
    const { register, handleSubmit, watch, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { fuelType: "GAS" } });
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
        mutationFn: async (values) => {
            const started = await sidecarClient.startTest({
                operatorId: user?.id ?? "unknown",
                plateNumber: values.plateNumber,
                fuelType: values.fuelType,
            });
            setStep("running");
            return sidecarClient.getResult(started.sessionToken);
        },
        onSuccess: (data) => { setResult(data); setStep("done"); },
        onError: () => setStep("error"),
    });
    const photoMutation = useMutation({
        mutationFn: () => sidecarClient.capturePhoto({ testId: result?.testId, photoType: "FRONT" }),
        onSuccess: () => setPhotoCaptured(true),
    });
    const printMutation = useMutation({
        mutationFn: () => sidecarClient.printReceipt({
            test_id: result.testId,
            plate_number: plate,
            vehicle_make: vehicle?.make ?? "—",
            vehicle_model: vehicle?.model ?? "—",
            year: vehicle?.year ?? 0,
            fuel_type: result.fuelType,
            pass_fail: result.passFail ?? false,
            operator_name: user?.fullName ?? "Operator",
            center_name: "PETC Center",
            copies: 2,
        }),
    });
    const reset = () => {
        setStep("idle");
        setResult(null);
        setPhotoCaptured(false);
        startMutation.reset();
    };
    return (_jsxs("div", { className: "max-w-2xl mx-auto p-6 space-y-5", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Emission Test" }), _jsxs("form", { onSubmit: handleSubmit((v) => { setStep("idle"); setResult(null); startMutation.mutate(v); }), className: "bg-white rounded-xl shadow p-6 space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Plate Number" }), _jsx("input", { ...register("plateNumber"), className: "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500", placeholder: "ABC 1234" }), errors.plateNumber && _jsx("p", { className: "mt-1 text-xs text-red-600", children: errors.plateNumber.message })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Fuel Type" }), _jsxs("select", { ...register("fuelType"), className: "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", children: [_jsx("option", { value: "GAS", children: "Gasoline" }), _jsx("option", { value: "DIESEL", children: "Diesel" })] })] })] }), vehicle && (_jsxs("div", { className: "rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900", children: [_jsxs("span", { className: "font-semibold", children: [vehicle.make, " ", vehicle.model, " (", vehicle.year, ")"] }), " — ", vehicle.ownerName] })), _jsx("button", { type: "submit", disabled: step === "running", className: clsx("w-full rounded-lg py-2.5 text-white font-semibold transition-colors", step === "running" ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"), children: step === "running" ? "Analyzer running…" : "Start Test" })] }), step === "running" && (_jsxs("div", { className: "flex items-center gap-3 bg-white rounded-xl shadow px-5 py-4 text-gray-600", children: [_jsx("div", { className: "h-5 w-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" }), _jsx("span", { className: "text-sm", children: "Waiting for analyzer result\u2026" })] })), step === "done" && result && (_jsxs("div", { className: clsx("rounded-xl shadow p-6 space-y-5", result.passFail ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"), children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: clsx("text-2xl font-bold", result.passFail ? "text-green-700" : "text-red-700"), children: result.passFail ? "PASSED" : "FAILED" }), _jsx("span", { className: clsx("rounded-full px-3 py-1 text-sm font-medium", result.passFail ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"), children: result.fuelType })] }), _jsx("div", { className: "grid grid-cols-2 gap-x-6 gap-y-2 text-sm", children: Object.entries(result.readings).map(([k, v]) => (_jsxs("div", { className: "flex justify-between border-b border-gray-200 pb-1", children: [_jsx("span", { className: "text-gray-500", children: k.replace(/_/g, " ").toUpperCase() }), _jsx("span", { className: "font-mono font-semibold", children: v ?? "—" })] }, k))) }), _jsxs("div", { className: "flex gap-3 pt-1", children: [_jsx("button", { onClick: () => photoMutation.mutate(), disabled: photoMutation.isPending || photoCaptured, className: "flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors", children: photoCaptured ? "Photo captured ✓" : photoMutation.isPending ? "Capturing…" : "Capture Photo" }), _jsx("button", { onClick: () => printMutation.mutate(), disabled: printMutation.isPending, className: "flex-1 rounded-lg bg-blue-600 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors", children: printMutation.isPending ? "Printing…" : "Print Receipt ×2" }), _jsx("button", { onClick: reset, className: "flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium hover:bg-gray-50 transition-colors", children: "New Test" })] }), printMutation.isSuccess && (_jsx("p", { className: "text-center text-sm text-green-700", children: "Receipt printed. Test queued for LTMS upload." }))] })), step === "error" && (_jsx("div", { className: "rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-800", children: "Test failed or timed out. Check the analyzer connection and try again." }))] }));
}
