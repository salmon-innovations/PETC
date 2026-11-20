import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { VideoCamera, WarningCircle, CaretDown, ArrowsClockwise, Crosshair } from "@phosphor-icons/react";

const STORAGE_KEY = "petc.camera.deviceId";

export type CameraStreamHandle = {
  /** Grab the current frame as a JPEG blob. Returns null if no stream is live. */
  captureBlob: (quality?: number) => Promise<Blob | null>;
  /** Grab the current frame as a data URL for instant review. */
  captureDataUrl: (quality?: number) => Promise<string | null>;
};

interface CameraStreamProps {
  showDevicePicker?: boolean;
  watermarkText?: string;
  className?: string;
}

export const CameraStream = forwardRef<CameraStreamHandle, CameraStreamProps>(
  ({ showDevicePicker = true, watermarkText, className = "" }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [deviceId, setDeviceId] = useState<string | null>(
      () => localStorage.getItem(STORAGE_KEY),
    );
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Enumerate cameras once permission is granted
    const enumerateCameras = async () => {
      setIsRefreshing(true);
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((t) => t.stop());
        const all = await navigator.mediaDevices.enumerateDevices();
        const vids = all.filter((d) => d.kind === "videoinput");
        setDevices(vids);
        if (!deviceId && vids.length > 0) {
          const preferred =
            vids.find((d) => !/iphone|continuity/i.test(d.label)) ?? vids[0];
          setDeviceId(preferred.deviceId);
          localStorage.setItem(STORAGE_KEY, preferred.deviceId);
        }
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "Camera access permission denied or unavailable.");
      } finally {
        setIsRefreshing(false);
      }
    };

    useEffect(() => {
      enumerateCameras();
      navigator.mediaDevices.addEventListener?.("devicechange", enumerateCameras);
      return () => navigator.mediaDevices.removeEventListener?.("devicechange", enumerateCameras);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Start / restart the stream when deviceId changes
    useEffect(() => {
      if (!deviceId) return;
      let cancelled = false;

      async function start() {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId! }, width: 1280, height: 720 },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
          setError(null);
        } catch (e: any) {
          setError(e?.message ?? "Could not open selected camera device.");
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
      async captureBlob(quality = 0.9): Promise<Blob | null> {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return null;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Burn-in watermark on captured canvas for legal compliance
        if (watermarkText) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fillRect(15, canvas.height - 50, canvas.width - 30, 36);
          ctx.font = "bold 15px monospace";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(watermarkText, 25, canvas.height - 26);
        }

        return await new Promise((resolve) =>
          canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality),
        );
      },
      async captureDataUrl(quality = 0.9): Promise<string | null> {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return null;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (watermarkText) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fillRect(15, canvas.height - 50, canvas.width - 30, 36);
          ctx.font = "bold 15px monospace";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(watermarkText, 25, canvas.height - 26);
        }

        return canvas.toDataURL("image/jpeg", quality);
      },
    }));

    function onPickDevice(id: string) {
      setDeviceId(id);
      localStorage.setItem(STORAGE_KEY, id);
    }

    return (
      <div className={`space-y-3 ${className}`}>
        {/* Camera device selector */}
        {showDevicePicker && (
          <div className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200/90 shadow-xs">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                <VideoCamera size={16} weight="bold" aria-hidden="true" />
              </div>
              <label className="text-xs font-bold text-slate-700 flex-shrink-0">
                Active Camera:
              </label>
              <div className="relative flex-1 min-w-0">
                <select
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-8 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  value={deviceId ?? ""}
                  onChange={(e) => onPickDevice(e.target.value)}
                  aria-label="Select camera device"
                >
                  {devices.length === 0 && <option value="">No optical cameras detected</option>}
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera Device (${d.deviceId.slice(0, 8)}…)`}
                    </option>
                  ))}
                </select>
                <CaretDown
                  size={14}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={enumerateCameras}
              title="Rescan cameras"
              className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 transition-colors flex-shrink-0 cursor-pointer"
            >
              <ArrowsClockwise size={16} weight="bold" className={isRefreshing ? "animate-spin text-blue-600" : ""} />
            </button>
          </div>
        )}

        {/* Video container with Viewfinder HUD */}
        <div className="relative rounded-3xl border-2 border-slate-800 bg-[#060a14] overflow-hidden aspect-video flex items-center justify-center shadow-2xl group">
          {error ? (
            <div className="flex flex-col items-center gap-3 p-6 text-center max-w-sm">
              <div className="w-12 h-12 rounded-2xl bg-red-950/60 border border-red-500/40 flex items-center justify-center text-red-400 shadow-inner">
                <WarningCircle size={26} weight="fill" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Camera Offline or Inaccessible</p>
                <p className="text-xs text-red-300 mt-1 leading-relaxed">{error}</p>
              </div>
              <button
                type="button"
                onClick={enumerateCameras}
                className="mt-1 rounded-xl bg-red-900/40 hover:bg-red-800/60 border border-red-700/60 text-white text-xs font-bold px-4 py-2 cursor-pointer transition-colors"
              >
                Retry Connection
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-contain"
              />

              {/* Viewfinder HUD Corner Brackets */}
              <div className="absolute inset-5 pointer-events-none border-2 border-transparent">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>

              {/* Vehicle Alignment Target Box */}
              <div className="absolute inset-x-12 sm:inset-x-24 inset-y-12 border border-dashed border-emerald-400/40 rounded-2xl pointer-events-none flex flex-col justify-between p-3">
                <div className="flex justify-between items-center text-[10px] font-mono text-emerald-400/80 font-bold tracking-widest uppercase">
                  <span>ALIGN LICENSE PLATE & EXHAUST</span>
                  <span>720P HD</span>
                </div>
                <div className="self-center">
                  <Crosshair size={28} className="text-emerald-400/60 animate-pulse" />
                </div>
                <div className="text-[10px] font-mono text-emerald-400/80 flex justify-between">
                  <span>TARGET LOCK</span>
                  <span>OPTICAL OCR READY</span>
                </div>
              </div>

              {/* Live Status Overlay Tag */}
              <div className="absolute top-4 left-4 bg-black/75 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1 flex items-center gap-2 text-xs text-white font-mono shadow-md">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-glow-emerald" />
                <span className="font-bold tracking-wider">LIVE FEED</span>
              </div>

              {/* Digital Watermark Overlay */}
              {watermarkText && (
                <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-2.5 text-xs text-slate-200 font-mono flex items-center justify-between shadow-xl">
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="truncate">{watermarkText}</span>
                  </div>
                  <span className="text-emerald-400 font-extrabold uppercase tracking-widest text-[11px] flex-shrink-0 ml-3 bg-emerald-950/60 border border-emerald-500/40 px-2.5 py-0.5 rounded-lg">
                    VERIFIED
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  },
);

CameraStream.displayName = "CameraStream";
