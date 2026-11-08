package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.time.LocalDate;

/**
 * LTMS v2 boundary DTOs. Upload payload fields deliberately remain a JSON
 * object until LTMS resolves the documented schema gaps (fuel/group/reading
 * matrix); this prevents silently inventing a government contract.
 */
public final class LtmsDtos {
    private LtmsDtos() { }

    public enum InspectionPurpose { FOR_RENEWAL, FOR_INIT_REG, FOR_COMPLIANCE }

    /** LTMS documents this endpoint without query parameters. */
    public record LimitsRequest() { }

    public record VehicleSearchRequest(
            InspectionPurpose purpose,
            String plateNumber,
            String mvFileNumber,
            String chassisNumber,
            String engineNumber,
            String dieselType
    ) {
        public VehicleSearchRequest {
            Objects.requireNonNull(purpose, "purpose is required");
            if (purpose == InspectionPurpose.FOR_INIT_REG) {
                if (blank(chassisNumber) || blank(engineNumber) || !blank(plateNumber) || !blank(mvFileNumber)) {
                    throw new IllegalArgumentException("Initial registration requires chassis and engine numbers only");
                }
            } else if (blank(plateNumber) && blank(mvFileNumber) && blank(chassisNumber) && blank(engineNumber)) {
                throw new IllegalArgumentException("Vehicle search requires a plate, MV file, chassis, or engine number");
            }
        }
    }

    public record CecUploadRequest(JsonNode payload) {
        public CecUploadRequest {
            if (payload == null || !payload.isObject()) throw new IllegalArgumentException("LTMS upload payload must be a JSON object");
        }
    }

    public record CecReplaceRequest(JsonNode payload) {
        public CecReplaceRequest {
            if (payload == null || !payload.isObject()) throw new IllegalArgumentException("LTMS replacement payload must be a JSON object");
        }
    }

    public record CecSearchRequest(String cecNumber, String inboxId) {
        public CecSearchRequest {
            if (blank(cecNumber) == blank(inboxId)) throw new IllegalArgumentException("Exactly one of cecNumber or inboxId is required");
        }
        public CecSearchRequest(String cecNumber) { this(cecNumber, null); }
    }

    public record UploadLimitsRequest(LocalDate searchDate) {
        public UploadLimitsRequest() { this(null); }
    }

    public record Reason(String code, String message) { }

    public record Error(Integer code, String message, List<Reason> reasons) {
        public Error {
            reasons = reasons == null ? List.of() : List.copyOf(reasons);
        }
        public LtmsOutcome outcome() { return LtmsErrorCodeCatalog.classify(code); }
    }

    /** Raw response is retained for restricted audit storage, never for logs. */
    public static final class Response {
        private final LtmsOperation operation;
        private final int httpStatus;
        private final String inboxId;
        private final Error error;
        private final JsonNode body;

        public Response(LtmsOperation operation, int httpStatus, String inboxId, Error error, JsonNode body) {
            this.operation = Objects.requireNonNull(operation, "operation");
            this.httpStatus = httpStatus;
            this.inboxId = inboxId;
            this.error = error;
            this.body = body;
        }
        public LtmsOperation operation() { return operation; }
        public int httpStatus() { return httpStatus; }
        public Optional<String> inboxId() { return Optional.ofNullable(inboxId); }
        public Optional<Error> error() { return Optional.ofNullable(error); }
        public JsonNode body() { return body; }
        public boolean isSuccess() { return error == null && httpStatus >= 200 && httpStatus < 300; }
        public LtmsOutcome outcome() { return error == null ? (isSuccess() ? LtmsOutcome.SUCCESS : LtmsOutcome.UNKNOWN) : error.outcome(); }

        @Override
        public String toString() {
            return "LtmsResponse[operation=" + operation + ", httpStatus=" + httpStatus
                    + ", inboxId=" + (inboxId == null ? null : LtmsRedactor.identifier(inboxId))
                    + ", errorCode=" + error().map(Error::code).orElse(null) + ", body=[REDACTED]]";
        }
    }

    private static boolean blank(String value) { return value == null || value.isBlank(); }
}
