/**
 * Typed HTTP client for the Python sidecar.
 * The base URL is resolved once at startup via window.petcBridge.getSidecarUrl()
 * and cached — it never changes for the lifetime of the window.
 */
import axios from "axios";
import { useAuthStore } from "../store/authStore";
let _client = null;
let _baseUrl = null;
async function client() {
    if (!_client) {
        _baseUrl = await window.petcBridge.getSidecarUrl();
        _client = axios.create({ baseURL: _baseUrl, timeout: 30_000 });
    }
    return _client;
}
export async function getSidecarBaseUrl() {
    await client();
    return _baseUrl;
}
export function sidecarErrorMessage(error) {
    if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        if (typeof detail === "string")
            return detail;
        if (detail?.message)
            return detail.message;
    }
    return "The request could not be completed. Check the sidecar and try again.";
}
// ── API calls ──────────────────────────────────────────────────────────────
export const sidecarClient = {
    async getStatus() {
        const c = await client();
        const { data } = await c.get("/status");
        return {
            analyzerConnected: data.analyzer_connected,
            printerStatus: data.printer_status,
            cloudOutboxPending: data.cloud_outbox_pending,
            agentVersion: data.agent_version,
            // null when the cloud has never answered — e.g. local-mock mode with no
            // PETC_CLOUD_URL. The UI hides the balance rather than showing a zero.
            walletBalanceCentavos: data.wallet_balance_centavos ?? null,
            walletLow: data.wallet_low ?? false,
            walletNegative: data.wallet_negative ?? false,
            walletBlockedCount: data.wallet_blocked_count ?? 0,
            walletFetchedAt: data.wallet_fetched_at ?? null,
            walletCenterId: data.wallet_center_id ?? null,
            walletChargePerUploadCentavos: data.wallet_charge_per_upload_centavos ?? null,
            walletLowBalanceThresholdCentavos: data.wallet_low_balance_threshold_centavos ?? null,
            walletPricingUpdatedAt: data.wallet_pricing_updated_at ?? null,
            centerId: data.center_id ?? null,
            centerName: data.center_name ?? null,
            laneId: data.lane_id ?? null,
            laneNumber: data.lane_number ?? null,
            laneActive: data.lane_active ?? null,
            laneIdentityConflict: data.lane_identity_conflict ?? false,
            laneQuotaUsed: data.lane_quota_used ?? null,
            laneQuotaReserved: data.lane_quota_reserved ?? null,
            laneQuotaLimit: data.lane_quota_limit ?? null,
            laneQuotaRemaining: data.lane_quota_remaining ?? null,
            laneQuotaBusinessDate: data.lane_quota_business_date ?? null,
            laneQuotaResetsAt: data.lane_quota_resets_at ?? null,
            laneQuotaFetchedAt: data.lane_quota_fetched_at ?? null,
            configured: data.configured ?? false,
            commissioningRequired: data.commissioning_required ?? true,
            config: data.config ?? {},
            readinessReady: data.readiness_ready ?? false,
            readinessReason: data.readiness_reason ?? "PETC commissioning is required",
        };
    },
    async validateCommissioning(params) {
        const c = await client();
        const token = await window.petcBridge.getCommissioningToken();
        const { data } = await c.post("/commissioning/validate", {
            cloud_url: params.cloudUrl, cloud_key: params.cloudKey,
            expected_center: params.expectedCenter, expected_lane: params.expectedLane,
        }, { headers: commissioningHeaders(token) });
        return data;
    },
    async saveCommissioning(params) {
        const c = await client();
        const token = await window.petcBridge.getCommissioningToken();
        const { data } = await c.post("/commissioning/save", {
            cloud_url: params.cloudUrl, cloud_key: params.cloudKey,
            expected_center: params.expectedCenter, expected_lane: params.expectedLane, confirmed: true,
        }, { headers: commissioningHeaders(token) });
        return data;
    },
    async startTest(params) {
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
    async getResult(sessionToken) {
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
    async abortTest(sessionToken) {
        const c = await client();
        await c.post(`/test/${sessionToken}/abort`);
    },
    async capturePhoto(params) {
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
    async photoUrl(photoId) {
        const base = await getSidecarBaseUrl();
        return `${base}/api/v1/photos/${photoId}`;
    },
    async uploadTestPhoto(params) {
        const c = await client();
        const form = new FormData();
        form.append("file", params.blob, "photo.jpg");
        // Do NOT set Content-Type here — the browser/axios needs to generate the
        // multipart boundary automatically. Setting it manually breaks the upload.
        const { data } = await c.post(`/api/v1/tests/${params.testId}/photo?photo_type=${params.photoType ?? "FRONT"}`, form);
        return {
            id: data.id,
            sizeBytes: data.size_bytes,
            capturedAt: data.captured_at,
        };
    },
    async printReceipt(req) {
        const c = await client();
        await c.post("/print/receipt", { ...req, copies: req.copies ?? 2 });
    },
    async lookupVehicle(plateNumber) {
        const c = await client();
        const { data } = await c.post("/api/v1/vehicle/lookup", { plate: plateNumber });
        return data;
    },
    async lookupDriver(licenseNo) {
        const c = await client();
        const { data } = await c.get(`/gov/driver/${licenseNo}`);
        return data;
    },
    async submitLtms(testId) {
        const c = await client();
        const { data } = await c.post(`/gov/submit/${testId}`, {});
        return data;
    },
    async getTestDetail(testId) {
        const c = await client();
        const { data } = await c.get(`/tests/${testId}`);
        return data;
    },
    async getTestPhotos(testId) {
        const c = await client();
        const { data } = await c.get(`/tests/${testId}/photos`);
        return data;
    },
    async submitUpload(payload) {
        const c = await client();
        const { data } = await c.post("/api/v1/upload/submit", { payload });
        return data;
    },
    async cecPdfUrl(submissionId) {
        const base = await getSidecarBaseUrl();
        return `${base}/api/v1/cec/${submissionId}/pdf`;
    },
    async printCec(submissionId, copies = 2) {
        const c = await client();
        const { data } = await c.post(`/api/v1/cec/${submissionId}/print`, { copies });
        return data;
    },
    async listSerialPorts() {
        const c = await client();
        const { data } = await c.get("/api/v1/ports");
        return data;
    },
    async getAnalyzerSettings() {
        const c = await client();
        const { data } = await c.get("/api/v1/settings/analyzer");
        return data;
    },
    async updateAnalyzerSettings(settings) {
        const c = await client();
        const { data } = await c.put("/api/v1/settings/analyzer", settings);
        return data;
    },
    async listCameras() {
        const c = await client();
        const { data } = await c.get("/api/v1/cameras");
        return data;
    },
    async getCameraSettings() {
        const c = await client();
        const { data } = await c.get("/api/v1/settings/camera");
        return data;
    },
    async updateCameraSettings(settings) {
        const c = await client();
        const { data } = await c.put("/api/v1/settings/camera", settings);
        return data;
    },
};
function commissioningHeaders(capability) {
    const session = useAuthStore.getState().token;
    return { "X-PETC-Commissioning-Token": capability, ...(session ? { Authorization: `Bearer ${session}` } : {}) };
}
