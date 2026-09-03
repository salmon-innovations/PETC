/**
 * Typed HTTP client for the Python sidecar.
 * The base URL is resolved once at startup via window.petcBridge.getSidecarUrl()
 * and cached — it never changes for the lifetime of the window.
 */
import axios from "axios";
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
export function isLtmsSuccessState(state) {
    return state === "PASSED" || state === "ACCEPTED";
}
export function isLtmsTerminalState(state) {
    return state === "PASSED" || state === "ACCEPTED"
        || state === "FAILED_EVALUATION" || state === "ACTION_REQUIRED"
        || state === "AUTH_BLOCKED" || state === "DEAD" || state === "REJECTED";
}
export function isLtmsNonterminalState(state) {
    return state === "PENDING" || state === "IN_FLIGHT" || state === "BLOCKED"
        || state === "DEFERRED" || state === "RECONCILING" || state === "WAITING_FOR_LTMS";
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
            billingMode: data.billing_mode ?? null,
            billingCurrentUsageCount: data.billing_current_usage_count ?? null,
            billingCurrentEstimateCentavos: data.billing_current_estimate_centavos ?? null,
            billingNextCutoff: data.billing_next_cutoff ?? null,
            billingOpenTotalCentavos: data.billing_open_total_centavos ?? null,
            billingPastDueTotalCentavos: data.billing_past_due_total_centavos ?? null,
            billingPastDueInvoiceCount: data.billing_past_due_invoice_count ?? null,
        };
    },
    async getBillingSummary() {
        const c = await client();
        const { data } = await c.get("/billing/summary");
        return {
            mode: data.mode,
            chargePerUploadCentavos: data.charge_per_upload_centavos,
            balanceCentavos: data.balance_centavos ?? null,
            low: data.low ?? false,
            negative: data.negative ?? false,
            blockedCount: data.blocked_count ?? 0,
            currentUsageCount: data.current_usage_count ?? null,
            currentEstimateCentavos: data.current_estimate_centavos ?? null,
            periodStart: data.period_start ?? null,
            nextCutoff: data.next_cutoff ?? null,
            openTotalCentavos: data.open_total_centavos ?? null,
            pastDueTotalCentavos: data.past_due_total_centavos ?? null,
            pastDueInvoiceCount: data.past_due_invoice_count ?? null,
        };
    },
    async createBillingTopUp(amountCentavos, clientRequestId) {
        const c = await client();
        const { data } = await c.post("/billing/topups", {
            amount_centavos: amountCentavos,
            client_request_id: clientRequestId,
        });
        return data;
    },
    async getBillingTopUp(id) {
        const c = await client();
        return (await c.get(`/billing/topups/${id}`)).data;
    },
    async getBillingInvoices() {
        const c = await client();
        return (await c.get("/billing/invoices?limit=20")).data;
    },
    async getBillingInvoice(id) {
        const c = await client();
        return (await c.get(`/billing/invoices/${id}`)).data;
    },
    async startTest(params) {
        const c = await client();
        const { data } = await c.post("/test/start", {
            operator_id: params.operatorId,
            plate_number: params.plateNumber,
            fuel_type: params.fuelType,
            inspection_purpose: params.inspectionPurpose,
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
