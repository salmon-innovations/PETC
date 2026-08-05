import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const STORAGE_KEY = "petc.camera.deviceId";

export type CameraStreamHandle = {
  /** Grab the current frame as a JPEG blob. Returns null if no stream is live. */
  captureBlob: (quality?: number) => Promise<Blob | null>;
};

export const CameraStream = forwardRef<CameraStreamHandle>((_props, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [error, setError] = useState<string | null>(null);

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
          const preferred =
            vids.find((d) => !/iphone|continuity/i.test(d.label)) ?? vids[0];
          setDeviceId(preferred.deviceId);
          localStorage.setItem(STORAGE_KEY, preferred.deviceId);
        }
      } catch (e: any) {
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
    if (!deviceId) return;
    let cancelled = false;

    async function start() {
      // Stop any previous stream first
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
    async captureBlob(quality = 0.9): Promise<Blob | null> {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return null;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) =>
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality),
      );
    },
  }));

  function onPickDevice(id: string) {
    setDeviceId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-700">Camera</label>
        <select
          className="text-xs border rounded px-2 py-1 flex-1"
          value={deviceId ?? ""}
          onChange={(e) => onPickDevice(e.target.value)}
        >
          {devices.length === 0 && <option value="">No cameras found</option>}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded-lg border border-gray-200 bg-black overflow-hidden aspect-video flex items-center justify-center">
        {error ? (
          <span className="text-xs text-red-300 p-3 text-center">{error}</span>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-contain"
          />
        )}
      </div>
    </div>
  );
});

CameraStream.displayName = "CameraStream";
