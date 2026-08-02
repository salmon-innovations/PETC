import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
const STORAGE_KEY = "petc.camera.deviceId";
export const CameraStream = forwardRef((_props, ref) => {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const [devices, setDevices] = useState([]);
    const [deviceId, setDeviceId] = useState(() => localStorage.getItem(STORAGE_KEY));
    const [error, setError] = useState(null);
    // Enumerate cameras once permission is granted
    useEffect(() => {
        async function enumerate() {
            try {
                // Trigger a permission prompt first so labels are populated
                const probe = await navigator.mediaDevices.getUserMedia({ video: true });
                probe.getTracks().forEach((t) => t.stop());
                const all = await navigator.mediaDevices.enumerateDevices();
                const vids = all.filter((d) => d.kind === "videoinput");
                setDevices(vids);
                if (!deviceId && vids.length > 0) {
                    // Prefer a device whose label doesn't mention "iPhone" / "Continuity"
                    const preferred = vids.find((d) => !/iphone|continuity/i.test(d.label)) ?? vids[0];
                    setDeviceId(preferred.deviceId);
                    localStorage.setItem(STORAGE_KEY, preferred.deviceId);
                }
            }
            catch (e) {
                setError(e?.message ?? "camera permission denied");
            }
        }
        enumerate();
        // Re-enumerate when devices are plugged/unplugged
        navigator.mediaDevices.addEventListener?.("devicechange", enumerate);
        return () => navigator.mediaDevices.removeEventListener?.("devicechange", enumerate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Start / restart the stream when deviceId changes
    useEffect(() => {
        if (!deviceId)
            return;
        let cancelled = false;
        async function start() {
            // Stop any previous stream first
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: deviceId }, width: 1280, height: 720 },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => { });
                }
                setError(null);
            }
            catch (e) {
                setError(e?.message ?? "could not open camera");
            }
        }
        start();
        return () => {
            cancelled = true;
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            }
        };
    }, [deviceId]);
    useImperativeHandle(ref, () => ({
        async captureBlob(quality = 0.9) {
            const video = videoRef.current;
            if (!video || !video.videoWidth)
                return null;
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx)
                return null;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
        },
    }));
    function onPickDevice(id) {
        setDeviceId(id);
        localStorage.setItem(STORAGE_KEY, id);
    }
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-xs font-medium text-gray-700", children: "Camera" }), _jsxs("select", { className: "text-xs border rounded px-2 py-1 flex-1", value: deviceId ?? "", onChange: (e) => onPickDevice(e.target.value), children: [devices.length === 0 && _jsx("option", { value: "", children: "No cameras found" }), devices.map((d) => (_jsx("option", { value: d.deviceId, children: d.label || `Camera ${d.deviceId.slice(0, 6)}` }, d.deviceId)))] })] }), _jsx("div", { className: "rounded-lg border border-gray-200 bg-black overflow-hidden aspect-video flex items-center justify-center", children: error ? (_jsx("span", { className: "text-xs text-red-300 p-3 text-center", children: error })) : (_jsx("video", { ref: videoRef, playsInline: true, muted: true, className: "w-full h-full object-contain" })) })] }));
});
CameraStream.displayName = "CameraStream";
