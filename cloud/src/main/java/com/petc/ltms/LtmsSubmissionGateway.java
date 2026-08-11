package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.config.LtmsCenterConfigRepository;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/** Performs one safety-gated, center-scoped LTMS upload command. */
@Component
public class LtmsSubmissionGateway {
    private static final ZoneId PHILIPPINE_TIME = ZoneId.of("Asia/Manila");

    private final LtmsCenterConfigRepository configs;
    private final LtmsCredentialsResolver credentialsResolver;
    private final LtmsTokenManager tokens;
    private final LtmsCecNumberAllocator cecNumbers;
    private final LtmsCecPayloadMapper payloadMapper;
    private final LtmsV2Client client;
    private final ObjectMapper mapper;

    public LtmsSubmissionGateway(
            LtmsCenterConfigRepository configs,
            LtmsCredentialsResolver credentialsResolver,
            LtmsTokenManager tokens,
            LtmsCecNumberAllocator cecNumbers,
            LtmsV2Client client,
            ObjectMapper mapper
    ) {
        this.configs = configs;
        this.credentialsResolver = credentialsResolver;
        this.tokens = tokens;
        this.cecNumbers = cecNumbers;
        this.client = client;
        this.mapper = mapper;
        this.payloadMapper = new LtmsCecPayloadMapper(mapper);
    }

    public Result upload(
            String submissionId,
            String tenantId,
            String centerId,
            String canonicalPayloadJson
    ) {
        var config = configs.findEnabledFor(tenantId, centerId)
                .orElseThrow(() -> new IllegalStateException("Center LTMS credentials are not enabled or the account is blocked"));
        if (config.environment() != LtmsCenterConfigRepository.LtmsEnvironment.PRODUCTION) {
            throw new IllegalStateException("Only a production LTMS center configuration may upload CEC records");
        }

        var allocation = cecNumbers.allocateForSubmission(submissionId, tenantId, config.petcCode());
        JsonNode canonical = parse(canonicalPayloadJson);
        LtmsDtos.CecUploadRequest request = payloadMapper.map(canonical, allocation.cecNumber());

        return credentialsResolver.withCredentials(config, credentials -> {
            ParsedLtmsJwt token = tokens.getOrAcquire(credentials);
            LtmsDtos.Response response = client.upload(context(config, token), request);
            if (response.outcome() == LtmsOutcome.AUTH_REFRESH_ONCE) {
                ParsedLtmsJwt refreshed = tokens.refreshOnce(credentials);
                response = client.upload(context(config, refreshed), request);
            }
            return interpret(response, allocation);
        });
    }

    private Result interpret(LtmsDtos.Response response, LtmsCecNumberAllocator.Allocation allocation) {
        JsonNode body = response.body();
        String inboxId = response.inboxId().orElse(text(body, "inbox_id"));
        if (response.isSuccess()) {
            String cecNumber = defaultIfBlank(text(body, "cec_number"), allocation.cecNumber());
            String evaluation = defaultIfBlank(text(body, "evaluation"), "PASSED").toUpperCase();
            return new Result(true, evaluation, cecNumber, allocation.orNumber(), inboxId,
                    expiry(text(body, "expiry_date")), null, null, reasons(body));
        }

        LtmsDtos.Error error = response.error().orElse(new LtmsDtos.Error(
                null, "LTMS rejected the CEC upload", java.util.List.of()));
        String message = error.message() == null || error.message().isBlank()
                ? "LTMS rejected the CEC upload" : error.message();
        return new Result(false, stateFor(response.outcome()), allocation.cecNumber(), allocation.orNumber(),
                inboxId, null, error.code(), message, reasons(body));
    }

    private JsonNode parse(String json) {
        try {
            return mapper.readTree(json);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Submission payload is not valid JSON", exception);
        }
    }

    private static LtmsRequestContext context(
            LtmsCenterConfigRepository.LtmsCenterConfig config,
            ParsedLtmsJwt token
    ) {
        return new LtmsRequestContext(config.ltmsUsername(), config.ltmsBusinessId(), token.rawToken());
    }

    private static String stateFor(LtmsOutcome outcome) {
        return switch (outcome) {
            case AUTH_BLOCKED, MISSING_PRIVILEGE -> "AUTH_BLOCKED";
            case FAILED_EVALUATION -> "FAILED_EVALUATION";
            // Keep explicit LTMS rejections operator-visible. The government
            // API does not define a safe automatic replay contract.
            case DEFER, DEFER_TO_NEXT_DAY -> "ACTION_REQUIRED";
            case RECONCILE -> "RECONCILING";
            default -> "ACTION_REQUIRED";
        };
    }

    private static Instant expiry(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return Instant.parse(value);
        } catch (java.time.format.DateTimeParseException noOffset) {
            return LocalDateTime.parse(value).atZone(PHILIPPINE_TIME).toInstant();
        }
    }

    private static String reasons(JsonNode body) {
        JsonNode value = body == null ? null : body.get("reasons");
        return value == null || !value.isArray() ? "[]" : value.toString();
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static String defaultIfBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    public record Result(
            boolean accepted,
            String evaluationOrState,
            String cecNumber,
            String orNumber,
            String inboxId,
            Instant expiry,
            Integer errorCode,
            String errorMessage,
            String reasonsJson
    ) { }
}
