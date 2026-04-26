/**
 * Typed HTTP client for the Python sidecar.
 * The base URL is resolved once at startup via window.petcBridge.getSidecarUrl()
 * and cached — it never changes for the lifetime of the window.
 */
import axios, { type AxiosInstance } from "axios";
import type { SidecarStatus, VehicleInfo, DriverInfo, OwnerInfo, EmissionTestDetail, TestPhoto } from "../types";

let _client: AxiosInstance | null = null;

async function client(): Promise<AxiosInstance> {
  if (!_client) {
    const base = await window.petcBridge.getSidecarUrl();
    _client = axios.create({ baseURL: base, timeout: 30_000 });
  }
  return _client;
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
};
