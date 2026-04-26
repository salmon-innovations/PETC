/**
 * Typed HTTP client for the Python sidecar.
 * The base URL is resolved once at startup via window.petcBridge.getSidecarUrl()
 * and cached — it never changes for the lifetime of the window.
 */
import axios from "axios";
let _client = null;
async function client() {
    if (!_client) {
        const base = await window.petcBridge.getSidecarUrl();
        _client = axios.create({ baseURL: base, timeout: 30_000 });
    }
    return _client;
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
        };
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
};
