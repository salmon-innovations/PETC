/**
 * Typed HTTP client for the Python sidecar.
 * The base URL is resolved once at startup via window.petcBridge.getSidecarUrl()
 * and cached — it never changes for the lifetime of the window.
 */
import axios, { type AxiosInstance } from "axios";
import type { SidecarStatus, VehicleInfo, DriverInfo, OwnerInfo, EmissionTestDetail, TestPhoto } from "../types";

let _client: AxiosInstance | null = null;

let _baseUrl: string | null = null;

async function client(): Promise<AxiosInstance> {
  if (!_client) {
    _baseUrl = await window.petcBridge.getSidecarUrl();
    _client = axios.create({ baseURL: _baseUrl, timeout: 30_000 });
  }
  return _client;
}

export async function getSidecarBaseUrl(): Promise<string> {
  await client();
  return _baseUrl!;
}

// ── types ──────────────────────────────────────────────────────────────────
export interface StartTestResponse {
  testId: string;
  sessionToken: string;
  startedAt: string;
}

export interface TestResultResponse {
  testId: string;
  sessionToken: string;
  passFail: boolean | null;
  fuelType: string;
  readings: Record<string, number | null>;
  capturedAt: string;
}

export interface PrintReceiptRequest {
  test_id: string;
  plate_number: string;
  vehicle_make: string;
  vehicle_model: string;
  year: number;
  fuel_type: string;
  pass_fail: boolean;
  operator_name: string;
  center_name: string;
  copies?: number;
}

export interface VehicleLookupResponse {
  found: boolean;
  source?: "LTMS" | "LTMS_CACHE" | "OFFLINE_CACHE";
  fetchedAt?: string | null;
  vehicle: VehicleInfo | null;
  owner?: OwnerInfo | null;
}

export interface DriverLookupResponse {
  found: boolean;
  driver: DriverInfo | null;
}

export interface LtmsSubmitResponse {
  state: "ACCEPTED" | "REJECTED" | "PENDING";
  certificateNo: string | null;
  rejectionReason: string | null;
  queued?: boolean;
  submissionId?: string;
}

export type AnalyzerType = "mock" | "serial_gas" | "serial_diesel" | "fty_opacimeter" | "fofen_gas" | "fofen_ascii";

export interface AnalyzerSettings {
  type: AnalyzerType;
  port: string;
  baud: number;
  dataBits: number;
  parity: "N" | "E" | "O";
  stopBits: number;
  address: string;
}

export interface SerialPortInfo {
  device: string;
  description: string;
  hwid: string;
  manufacturer: string;
}

export type CameraType = "mock" | "opencv";

export interface CameraSettings {
  type: CameraType;
  device: number;
}

export interface CameraInfo {
  index: number;
  label: string;
  resolution: string;
}

// ── API calls ──────────────────────────────────────────────────────────────
export const sidecarClient = {
  async getStatus(): Promise<SidecarStatus> {
    const c = await client();
    const { data } = await c.get("/status");
    return {
      analyzerConnected: data.analyzer_connected,
      printerStatus: data.printer_status,
      cloudOutboxPending: data.cloud_outbox_pending,
      agentVersion: data.agent_version,
    };
  },

  async startTest(params: {
    operatorId: string;
    plateNumber: string;
    fuelType: string;
  }): Promise<StartTestResponse> {
    const c = await client();
    const { data } = await c.post("/test/start", {
      operator_id: params.operatorId,
      plate_number: params.plateNumber,
      fuel_type: params.fuelType,
    });
    return {
      testId: data.test_id,
      sessionToken: data.session_token,
      startedAt: data.started_at,
    };
  },

  async getResult(sessionToken: string): Promise<TestResultResponse> {
    const c = await client();
    const { data } = await c.get(`/test/${sessionToken}/result`);
    return {
      testId: data.test_id,
      sessionToken: data.session_token,
      passFail: data.pass_fail,
      fuelType: data.fuel_type,
      readings: data.readings,
      capturedAt: data.captured_at,
    };
  },

  async abortTest(sessionToken: string): Promise<void> {
    const c = await client();
    await c.post(`/test/${sessionToken}/abort`);
  },

  async capturePhoto(params?: {
    testId?: string;
    photoType?: string;
  }): Promise<{ id: string; testId: string | null; mimeType: string; sizeBytes: number; capturedAt: string; filePath: string | null }> {
    const c = await client();
    const { data } = await c.post("/camera/capture", {
      test_id: params?.testId,
      photo_type: params?.photoType ?? "OTHER",
    });
    return {
      id: data.id,
      testId: data.test_id,
      mimeType: data.mime_type,
      sizeBytes: data.size_bytes,
      capturedAt: data.captured_at,
      filePath: data.file_path,
    };
  },

  async photoUrl(photoId: string): Promise<string> {
    const base = await getSidecarBaseUrl();
    return `${base}/api/v1/photos/${photoId}`;
  },

  async uploadTestPhoto(params: {
    testId: string;
    blob: Blob;
    photoType?: string;
  }): Promise<{ id: string; sizeBytes: number; capturedAt: string }> {
    const c = await client();
    const form = new FormData();
    form.append("file", params.blob, "photo.jpg");
    // Do NOT set Content-Type here — the browser/axios needs to generate the
    // multipart boundary automatically. Setting it manually breaks the upload.
    const { data } = await c.post(
      `/api/v1/tests/${params.testId}/photo?photo_type=${params.photoType ?? "FRONT"}`,
      form,
    );
    return {
      id: data.id,
      sizeBytes: data.size_bytes,
      capturedAt: data.captured_at,
    };
  },

  async printReceipt(req: PrintReceiptRequest): Promise<void> {
    const c = await client();
    await c.post("/print/receipt", { ...req, copies: req.copies ?? 2 });
  },

  async lookupVehicle(plateNumber: string): Promise<VehicleLookupResponse> {
    const c = await client();
    const { data } = await c.post("/api/v1/vehicle/lookup", { plate: plateNumber });
    return data;
  },

  async lookupDriver(licenseNo: string): Promise<DriverLookupResponse> {
    const c = await client();
    const { data } = await c.get(`/gov/driver/${licenseNo}`);
    return data;
  },

  async submitLtms(testId: string): Promise<LtmsSubmitResponse> {
    const c = await client();
    const { data } = await c.post(`/gov/submit/${testId}`, {});
    return data;
  },

  async getTestDetail(testId: string): Promise<EmissionTestDetail> {
    const c = await client();
    const { data } = await c.get(`/tests/${testId}`);
    return data;
  },

  async getTestPhotos(testId: string): Promise<TestPhoto[]> {
    const c = await client();
    const { data } = await c.get(`/tests/${testId}/photos`);
    return data;
  },

  async submitUpload(payload: Record<string, unknown>): Promise<LtmsSubmitResponse> {
    const c = await client();
    const { data } = await c.post("/api/v1/upload/submit", { payload });
    return data;
  },

  async cecPdfUrl(submissionId: string): Promise<string> {
    const base = await getSidecarBaseUrl();
    return `${base}/api/v1/cec/${submissionId}/pdf`;
  },

  async printCec(submissionId: string, copies = 2): Promise<{ printed: boolean; copies: number }> {
    const c = await client();
    const { data } = await c.post(`/api/v1/cec/${submissionId}/print`, { copies });
    return data;
  },

  async listSerialPorts(): Promise<SerialPortInfo[]> {
    const c = await client();
    const { data } = await c.get("/api/v1/ports");
    return data;
  },

  async getAnalyzerSettings(): Promise<AnalyzerSettings> {
    const c = await client();
    const { data } = await c.get("/api/v1/settings/analyzer");
    return data;
  },

  async updateAnalyzerSettings(settings: AnalyzerSettings): Promise<{ applied: boolean; connected: boolean }> {
    const c = await client();
    const { data } = await c.put("/api/v1/settings/analyzer", settings);
    return data;
  },

  async listCameras(): Promise<CameraInfo[]> {
    const c = await client();
    const { data } = await c.get("/api/v1/cameras");
    return data;
  },

  async getCameraSettings(): Promise<CameraSettings> {
    const c = await client();
    const { data } = await c.get("/api/v1/settings/camera");
    return data;
  },

  async updateCameraSettings(settings: CameraSettings): Promise<{ applied: boolean }> {
    const c = await client();
    const { data } = await c.put("/api/v1/settings/camera", settings);
    return data;
  },
};
