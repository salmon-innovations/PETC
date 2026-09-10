import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { sidecarClient } from "../../api/sidecarClient";
import { useAuthStore } from "../../store/authStore";
import { CameraStream } from "../../components/CameraStream";
import { INSPECTION_PURPOSE_LABELS } from "../../types";
const schema = z.object({
    plateNumber: z.string().min(3, "Enter plate number"),
    fuelType: z.enum(["GAS", "DIESEL"]),
    inspectionPurpose: z.enum(["FOR_RENEWAL", "FOR_INIT_REG", "FOR_COMPLIANCE"]),
});
export default function RunTestPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const [result, setResult] = useState(null);
    const [step, setStep] = useState("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const [photoCaptured, setPhotoCaptured] = useState(false);
    const cameraRef = useRef(null);
    const activeSessionToken = useRef(null);
    const cancelledByOperator = useRef(false);
    const { register, handleSubmit, watch, formState: { errors } } = useForm({
        resolver: zodResolver(schema),
        defaultValues: { fuelType: "GAS", inspectionPurpose: "FOR_RENEWAL" },
    });
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
            cancelledByOperator.current = false;
            const started = await sidecarClient.startTest({
                operatorId: user?.id ?? "unknown",
                plateNumber: values.plateNumber,
                fuelType: values.fuelType,
                inspectionPurpose: values.inspectionPurpose,
            });
            activeSessionToken.current = started.sessionToken;
            setStep("running");
            const r = await sidecarClient.getResult(started.sessionToken);
            activeSessionToken.current = null;
            // Grab the current frame from the live preview and upload it
            try {
                const blob = await cameraRef.current?.captureBlob();
                if (!blob) {
                    console.warn("Photo capture skipped: no live preview frame available");
                }
                else {
                    await sidecarClient.uploadTestPhoto({ testId: r.testId, blob, photoType: "FRONT" });
                    setPhotoCaptured(true);
                }
            }
            catch (err) {
                console.error("Photo upload failed:", err);
            }
            return r;
        },
        onSuccess: (data) => {
            activeSessionToken.current = null;
            setResult(data);
            setStep("done");
            queryClient.invalidateQueries({ queryKey: ["tests", "pending-ltms"] });
        },
        onError: (error) => {
            activeSessionToken.current = null;
            if (cancelledByOperator.current) {
                cancelledByOperator.current = false;
                setStep("idle");
                return;
            }
            const detail = error
                .response?.data?.detail;
            setErrorMessage(typeof detail === "string"
                ? detail
                : "Test failed or timed out. Check the analyzer connection and try again.");
            setStep("error");
        },
    });
    const reset = () => {
        activeSessionToken.current = null;
        cancelledByOperator.current = false;
        setStep("idle");
        setResult(null);
        setErrorMessage("");
        setPhotoCaptured(false);
        startMutation.reset();
    };
    const cancelRunningTest = async () => {
        cancelledByOperator.current = true;
        const sessionToken = activeSessionToken.current;
        activeSessionToken.current = null;
        if (sessionToken) {
            try {
                await sidecarClient.abortTest(sessionToken);
            }
            catch (error) {
                console.warn("Analyzer abort failed", error);
            }
        }
        setStep("idle");
        setResult(null);
        setErrorMessage("");
        setPhotoCaptured(false);
    };
    return (_jsxs("div", { className: "max-w-2xl mx-auto p-6 space-y-5", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Emission Test" }), _jsxs("form", { onSubmit: handleSubmit((v) => {
                    setStep("idle");
                    setResult(null);
                    setErrorMessage("");
                    startMutation.mutate(v);
                }), className: "bg-white rounded-xl shadow p-6 space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Plate Number" }), _jsx("input", { ...register("plateNumber"), className: "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500", placeholder: "ABC 1234" }), errors.plateNumber && _jsx("p", { className: "mt-1 text-xs text-red-600", children: errors.plateNumber.message })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Fuel Type" }), _jsxs("select", { ...register("fuelType"), className: "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", children: [_jsx("option", { value: "GAS", children: "Gasoline" }), _jsx("option", { value: "DIESEL", children: "Diesel" })] })] }), _jsxs("div", { className: "col-span-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "LTMS Transaction Purpose" }), _jsx("select", { ...register("inspectionPurpose"), className: "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500", children: Object.entries(INSPECTION_PURPOSE_LABELS).map(([value, label]) => (_jsx("option", { value: value, children: label }, value))) }), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "Required by LTMS and locked to this test once started." })] })] }), vehicle && (_jsxs("div", { className: "rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900", children: [_jsxs("span", { className: "font-semibold", children: [vehicle.make, " ", vehicle.model, " (", vehicle.year, ")"] }), " — ", vehicle.ownerName] })), _jsx(CameraStream, { ref: cameraRef }), _jsx("button", { type: "submit", disabled: step === "running", className: clsx("w-full rounded-lg py-2.5 text-white font-semibold transition-colors", step === "running" ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"), children: step === "running" ? "Analyzer running…" : "Start Test" })] }), step === "running" && (_jsxs("div", { className: "flex items-center justify-between gap-3 bg-white rounded-xl shadow px-5 py-4 text-gray-600", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "h-5 w-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" }), _jsx("span", { className: "text-sm", children: "Waiting for analyzer result\u2026 follow the analyzer's test procedure." })] }), _jsx("button", { type: "button", onClick: () => void cancelRunningTest(), className: "text-xs text-gray-500 hover:text-red-600 underline", children: "Cancel" })] })), step === "done" && result && (_jsxs("div", { className: "rounded-xl shadow p-6 space-y-5 bg-white border border-gray-200", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-800", children: "READING" }), _jsx("span", { className: "rounded-full px-3 py-1 text-sm font-medium bg-gray-100 text-gray-700", children: result.fuelType })] }), _jsx("div", { className: "grid grid-cols-2 gap-x-6 gap-y-2 text-sm", children: Object.entries(result.readings).map(([k, v]) => (_jsxs("div", { className: "flex justify-between border-b border-gray-200 pb-1", children: [_jsx("span", { className: "text-gray-500", children: k.replace(/_/g, " ").toUpperCase() }), _jsx("span", { className: "font-mono font-semibold", children: v ?? "—" })] }, k))) }), result.revolutionKValues.length === 6 && (_jsxs("div", { children: [_jsx("h3", { className: "mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500", children: "Six-revolution K maxima" }), _jsx("div", { className: "grid grid-cols-3 gap-2 sm:grid-cols-6", children: result.revolutionKValues.map((value, index) => (_jsxs("div", { className: "rounded border border-gray-200 bg-gray-50 p-2 text-center", children: [_jsxs("div", { className: "text-[10px] text-gray-500", children: ["REV ", index + 1] }), _jsx("div", { className: "font-mono text-sm font-semibold", children: value.toFixed(2) })] }, index))) })] })), photoCaptured && (_jsx("div", { className: "text-xs text-green-700", children: "Photo captured \u2713" })), _jsxs("p", { className: "text-xs text-gray-500", children: ["Test queued for LTMS upload. Open the ", _jsx("strong", { children: "LTMS Upload" }), " page to submit and print the CEC."] }), _jsxs("div", { className: "flex gap-3 pt-1", children: [_jsx("button", { onClick: reset, className: "flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium hover:bg-gray-50 transition-colors", children: "New Test" }), _jsx("button", { type: "button", onClick: () => navigate(`/upload?testId=${encodeURIComponent(result.testId)}`), className: "flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors", children: "Continue to LTMS Upload" })] })] })), step === "error" && (_jsxs("div", { className: "rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-800 flex items-center justify-between", children: [_jsx("span", { children: errorMessage }), _jsx("button", { type: "button", onClick: reset, className: "rounded bg-red-600 text-white px-3 py-1 text-xs hover:bg-red-700", children: "Reset" })] }))] }));
}
