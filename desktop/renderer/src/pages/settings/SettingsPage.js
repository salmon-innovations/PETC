import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sidecarClient } from "../../api/sidecarClient";
const ANALYZER_TYPES = [
    { value: "mock", label: "Mock (no hardware)" },
    { value: "serial_gas", label: "Gas analyzer — ASCII" },
    { value: "serial_diesel", label: "Diesel analyzer — Binary" },
    { value: "fty_opacimeter", label: "FTY-100 Opacimeter (FOFEN SINGLE)" },
    { value: "fofen_gas", label: "Fofen Petrol Gas Analyzer — binary push" },
    { value: "fofen_ascii", label: "Fofen Petrol Gas Analyzer — ASCII receipt (PRINT)" },
    { value: "koeng_gas", label: "KOENG KEG-500 CE Gas Analyzer" },
    { value: "koeng_diesel", label: "KOENG Diesel Analyzer" },
    { value: "cartesykj_gas", label: "CARTESYKJ MQ-550 Gas Analyzer" },
    { value: "cartesykj_diesel", label: "CARTESYKJ MQY-200 Diesel Analyzer" },
];
const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200];
export default function SettingsPage() {
    const { data: status } = useQuery({
        queryKey: ["sidecar-status"],
        queryFn: sidecarClient.getStatus,
    });
    return (_jsxs("div", { className: "max-w-xl mx-auto p-6 space-y-6", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "Settings" }), _jsxs("section", { className: "bg-white rounded-xl shadow divide-y", children: [_jsx(Row, { label: "Agent Version", value: status?.agentVersion ?? "—" }), _jsx(Row, { label: "Analyzer", value: status?.analyzerConnected ? "Connected" : "Offline", ok: status?.analyzerConnected }), _jsx(Row, { label: "Printer", value: status?.printerStatus.online ? "Online" : "Offline", ok: status?.printerStatus.online }), _jsx(Row, { label: "Paper", value: status?.printerStatus.paper_ok ? "OK" : "Low / empty", ok: status?.printerStatus.paper_ok }), _jsx(Row, { label: "Cloud sync queue", value: `${status?.cloudOutboxPending ?? "—"} pending` })] }), _jsx(AnalyzerHardwareSection, {}), _jsx(CameraHardwareSection, {}), _jsxs("section", { className: "bg-white rounded-xl shadow p-5 space-y-2", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Data Location" }), _jsx(DataPath, {})] }), _jsx(CommissioningSection, {})] }));
}
function CommissioningSection() {
    const [message, setMessage] = useState(null);
    return (_jsxs("section", { className: "bg-white rounded-xl shadow p-5 space-y-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Center Commissioning" }), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "Import a center-specific properties file downloaded from the PETC portal. The app restarts after a successful import." })] }), _jsx("button", { type: "button", onClick: async () => {
                    const result = await window.petcBridge.importCommissioning();
                    setMessage(result.message);
                }, className: "rounded border border-gray-300 px-3 py-2 text-xs hover:bg-gray-50", children: "Import commissioning file" }), message && _jsx("p", { className: "text-xs text-gray-600", children: message })] }));
}
function Row({ label, value, ok }) {
    return (_jsxs("div", { className: "flex items-center justify-between px-5 py-3 text-sm", children: [_jsx("span", { className: "text-gray-600", children: label }), _jsx("span", { className: ok === false ? "text-red-600 font-medium" : ok === true ? "text-green-700 font-medium" : "text-gray-800", children: value })] }));
}
function DataPath() {
    const { data: path } = useQuery({
        queryKey: ["userData"],
        queryFn: () => window.petcBridge.getUserDataPath(),
    });
    return (_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("code", { className: "text-xs text-gray-500 truncate", children: path ?? "…" }), _jsx("button", { onClick: () => path && window.petcBridge.openPath(path), className: "flex-shrink-0 rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50", children: "Open" })] }));
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
    const [form, setForm] = useState(null);
    const [advanced, setAdvanced] = useState(false);
    const [savedMsg, setSavedMsg] = useState(null);
    useEffect(() => {
        if (saved && form === null)
            setForm(saved);
    }, [saved, form]);
    const mutation = useMutation({
        mutationFn: (payload) => sidecarClient.updateAnalyzerSettings(payload),
        onSuccess: (res) => {
            setSavedMsg(res.connected ? "Saved & connected." : "Saved (analyzer offline).");
            queryClient.invalidateQueries({ queryKey: ["analyzer-settings"] });
            queryClient.invalidateQueries({ queryKey: ["sidecar-status"] });
        },
        onError: (err) => {
            const message = err && typeof err === "object" && "response" in err
                // @ts-expect-error axios error shape
                ? err.response?.data?.detail ?? String(err)
                : String(err);
            setSavedMsg(`Failed: ${message}`);
        },
    });
    if (form === null) {
        return (_jsxs("section", { className: "bg-white rounded-xl shadow p-5", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Analyzer Hardware" }), _jsx("p", { className: "text-xs text-gray-500 mt-2", children: "Loading\u2026" })] }));
    }
    const isSerial = form.type !== "mock";
    return (_jsxs("section", { className: "bg-white rounded-xl shadow p-5 space-y-4", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Analyzer Hardware" }), _jsx(Field, { label: "Analyzer type", children: _jsx("select", { className: "w-full border rounded px-2 py-1 text-sm", value: form.type, onChange: (e) => {
                        const type = e.target.value;
                        const typeChanged = type !== form.type;
                        setForm(type === "koeng_gas" || type === "koeng_diesel" || type === "cartesykj_gas" || type === "cartesykj_diesel"
                            ? {
                                ...form,
                                type,
                                baud: 9600,
                                dataBits: 8,
                                parity: "N",
                                stopBits: 1,
                                serialNo: typeChanged ? "" : form.serialNo,
                            }
                            : { ...form, type, serialNo: typeChanged ? "" : form.serialNo });
                    }, children: ANALYZER_TYPES.map((t) => (_jsx("option", { value: t.value, children: t.label }, t.value))) }) }), isSerial && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "COM port", children: _jsxs("div", { className: "flex gap-2", children: [_jsxs("select", { className: "flex-1 border rounded px-2 py-1 text-sm", value: form.port, onChange: (e) => setForm({ ...form, port: e.target.value }), children: [!ports?.some((p) => p.device === form.port) && (_jsxs("option", { value: form.port, children: [form.port, " (not detected)"] })), ports?.map((p) => (_jsxs("option", { value: p.device, children: [p.device, p.description ? ` — ${p.description}` : ""] }, p.device)))] }), _jsx("button", { type: "button", onClick: () => refetchPorts(), disabled: portsLoading, className: "rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50", children: portsLoading ? "…" : "Refresh" })] }) }), _jsx(Field, { label: "Baud rate", children: _jsx("select", { className: "w-full border rounded px-2 py-1 text-sm", value: form.baud, onChange: (e) => setForm({ ...form, baud: Number(e.target.value) }), children: BAUD_OPTIONS.map((b) => (_jsx("option", { value: b, children: b }, b))) }) }), (form.type === "koeng_gas" || form.type === "koeng_diesel" || form.type === "cartesykj_gas" || form.type === "cartesykj_diesel") && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "Analyzer serial number", children: _jsx("input", { className: "w-full border rounded px-2 py-1 text-sm font-mono", value: form.serialNo, onChange: (e) => setForm({ ...form, serialNo: e.target.value }), placeholder: "From the calibration plate" }) }), form.type === "cartesykj_gas" ? (_jsx("p", { className: "text-xs text-gray-500", children: "CARTESYKJ MQ-550 communication is fixed at 9600 baud, 8N1 and uses a polled current-analysis request. Close other serial tools before connecting because COM ports are exclusive." })) : form.type === "cartesykj_diesel" ? (_jsx("p", { className: "text-xs text-gray-500", children: "CARTESYKJ MQY-200 communication is fixed at 9600 baud, 8N1. A test calibrates the machine, samples six acceleration cycles, and reports the average of the six maximum K readings. Close other serial tools before connecting because COM ports are exclusive. Its documented frame does not provide opacity or RPM, so LTMS upload remains blocked until those fields have a verified machine source." })) : (_jsx("p", { className: "text-xs text-gray-500", children: "KOENG communication is fixed at 9600 baud, 8N1. The diesel analyzer continuously transmits readings. Close the vendor Koeng Analyzer System before connecting because COM ports are exclusive." }))] })), _jsx("button", { type: "button", className: "text-xs text-blue-600 hover:underline", onClick: () => setAdvanced(!advanced), children: advanced ? "▾ Hide advanced" : "▸ Advanced (data bits / parity / stop bits / address)" }), advanced && (_jsxs("div", { className: "grid grid-cols-2 gap-3 pt-1", children: [_jsx(Field, { label: "Data bits", children: _jsxs("select", { className: "w-full border rounded px-2 py-1 text-sm", value: form.dataBits, onChange: (e) => setForm({ ...form, dataBits: Number(e.target.value) }), children: [_jsx("option", { value: 7, children: "7" }), _jsx("option", { value: 8, children: "8" })] }) }), _jsx(Field, { label: "Parity", children: _jsxs("select", { className: "w-full border rounded px-2 py-1 text-sm", value: form.parity, onChange: (e) => setForm({ ...form, parity: e.target.value }), children: [_jsx("option", { value: "N", children: "None" }), _jsx("option", { value: "E", children: "Even" }), _jsx("option", { value: "O", children: "Odd" })] }) }), _jsx(Field, { label: "Stop bits", children: _jsxs("select", { className: "w-full border rounded px-2 py-1 text-sm", value: form.stopBits, onChange: (e) => setForm({ ...form, stopBits: Number(e.target.value) }), children: [_jsx("option", { value: 1, children: "1" }), _jsx("option", { value: 2, children: "2" })] }) }), _jsx(Field, { label: "Device address (hex)", children: _jsx("input", { className: "w-full border rounded px-2 py-1 text-sm font-mono", value: form.address, onChange: (e) => setForm({ ...form, address: e.target.value }), placeholder: "01" }) })] }))] })), _jsxs("div", { className: "flex items-center justify-between pt-2", children: [_jsx("span", { className: `text-xs ${savedMsg?.startsWith("Failed") ? "text-red-600" : "text-green-700"}`, children: savedMsg ?? "" }), _jsx("button", { type: "button", disabled: mutation.isPending, onClick: () => mutation.mutate(form), className: "rounded bg-blue-600 text-white px-4 py-1.5 text-sm hover:bg-blue-700 disabled:opacity-50", children: mutation.isPending ? "Applying…" : "Save & reconnect" })] })] }));
}
function Field({ label, children }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "text-xs text-gray-600", children: label }), children] }));
}
function CameraHardwareSection() {
    return (_jsxs("section", { className: "bg-white rounded-xl shadow p-5 space-y-2", children: [_jsx("h2", { className: "font-semibold text-sm text-gray-700", children: "Camera" }), _jsxs("p", { className: "text-xs text-gray-600", children: ["The camera is managed by the app's built-in capture (the same way a website accesses your camera). Pick the camera and confirm the live preview on the", " ", _jsx("span", { className: "font-medium", children: "Run Test" }), " page \u2014 selection persists."] })] }));
}
