package com.petc.submissions;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.gov.EmissionPayload;
import com.petc.gov.GovRegistryClient;
import com.petc.gov.SubmissionResult;
import com.petc.settings.PlatformSettingsService;
import com.petc.wallet.WalletService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Background worker that picks PENDING submissions and calls the gov client.
 * Runs every 2s. Backoff mirrors desktop/sidecar/petc/cloud_sync/pusher.py.
 */
@Component
public class SubmissionJobRunner {

    private static final Logger log = LoggerFactory.getLogger(SubmissionJobRunner.class);
    private static final int BATCH_SIZE = 10;

    private final SubmissionService service;
    private final GovRegistryClient govClient;
    private final ObjectMapper mapper;
    private final PlatformSettingsService settings;
    private final WalletService wallet;

    public SubmissionJobRunner(
            SubmissionService service,
            GovRegistryClient govClient,
            ObjectMapper mapper,
            PlatformSettingsService settings,
            WalletService wallet
    ) {
        this.service = service;
        this.govClient = govClient;
        this.mapper = mapper;
        this.settings = settings;
        this.wallet = wallet;
    }

    /**
     * Dispatch loop. Each submission must be affordable before it is filed:
     * the cloud is the only route to LTMS, so this is where prepaid billing is
     * enforced.
     *
     * The affordability check runs per batch with a running per-tenant total,
     * not per row against the stored balance. Ten queued rows for a center with
     * funds for three must file three and hold seven; re-reading the same
     * balance ten times would file all ten.
     */
    @Scheduled(fixedDelay = 2000)
    public void processPending() {
        int expired = service.moveExpiredClaimsToReconciling();
        if (expired > 0) {
            log.warn("Moved {} expired submission claim(s) to reconciliation", expired);
        }
        List<SubmissionService.PendingSubmission> batch = service.claimPending(BATCH_SIZE);
        Map<String, Long> projected = new HashMap<>();

        for (var sub : batch) {
            long charge = sub.chargeSnapshotCentavos();
            Long remainingBefore = null;
            // Rows the grace sweep already released bypass the wallet entirely.
            // This is deliberately the only path that lets a balance go
            // negative: a billing shortfall must not become a DO 2023-008
            // compliance breach.
            if (!sub.graceReleased() && charge > 0) {
                long remaining = projected.computeIfAbsent(sub.tenantId(), wallet::getBalance);
                if (remaining < charge) {
                    service.markBlocked(sub.id(), sub.tenantId(), remaining);
                    continue;
                }
                remainingBefore = remaining;
            }
            boolean accepted = process(sub, charge);
            if (accepted && charge > 0) {
                if (remainingBefore != null) {
                    projected.put(sub.tenantId(), remainingBefore - charge);
                } else {
                    projected.computeIfPresent(
                            sub.tenantId(), (ignored, value) -> value - charge);
                }
            }
        }
    }

    private boolean process(SubmissionService.PendingSubmission sub, long chargeCentavos) {
        try {
            EmissionPayload payload = toEmissionPayload(sub);
            SubmissionResult result = govClient.submitEmissionResult(payload);
            if (result.isAccepted()) {
                // Acceptance and the wallet debit commit together — see
                // SubmissionService.markAcceptedAndCharge.
                service.markAcceptedAndCharge(
                        sub.id(),
                        sub.tenantId(),
                        result.certificateNo(),
                        null,
                        result.orNo(),
                        result.dermalogToken(),
                        result.validFrom(),
                        result.validUntil(),
                        chargeCentavos
                );
                return true;
            } else {
                // Gov rejections are definitive — do not retry
                service.markRejected(sub.id(), result.rejectionReason());
                return false;
            }
        } catch (Exception e) {
            log.warn("Submission {} attempt {} failed: {}", sub.id(), sub.attempts(), e.getMessage());
            service.markRetry(sub.id(), sub.attempts(),
                    settings.maxAttempts(), settings.backoffSeconds());
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private EmissionPayload toEmissionPayload(SubmissionService.PendingSubmission sub) {
        try {
            Map<String, Object> payload = mapper.readValue(
                    sub.payloadJson(), new TypeReference<Map<String, Object>>() {});

            Map<String, Object> readings = (Map<String, Object>) payload.getOrDefault("readings", Map.of());
            List<Map<String, Object>> rawPhotos = (List<Map<String, Object>>) payload.getOrDefault("photos", List.of());
            Map<String, Object> vehicle = objectMap(payload.get("vehicle"));
            Map<String, Object> verdict = objectMap(payload.get("verdict"));

            List<EmissionPayload.PhotoRef> photos = rawPhotos.stream()
                    .map(p -> new EmissionPayload.PhotoRef(
                            (String) p.get("photoId"),
                            (String) p.get("s3Key"),
                            (String) p.get("photoType"),
                            (String) p.get("sha256")
                    ))
                    .toList();

            return new EmissionPayload(
                    sub.testId(),
                    firstNonBlank(stringValue(vehicle.get("plateNo")),
                            stringValue(vehicle.get("plateNumber")), stringValue(payload.get("plateNumber"))),
                    stringValue(payload.get("licenseNo")),
                    firstNonBlank(stringValue(vehicle.get("fuelType")),
                            stringValue(payload.get("fuelType")), "GAS"),
                    verdict.get("pass") instanceof Boolean pass
                            ? pass : Boolean.TRUE.equals(payload.get("passFail")),
                    readings,
                    photos,
                    stringValue(payload.get("operatorId")),
                    sub.tenantId(),
                    capturedAt(payload)
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to deserialise submission payload for " + sub.id(), e);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> objectMap(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static String stringValue(Object value) {
        return value == null ? "" : value.toString();
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) return value;
        }
        return "";
    }

    /** Preserve the captured test time; dispatch time is only a legacy fallback. */
    private static Instant capturedAt(Map<String, Object> payload) {
        String raw = firstNonBlank(stringValue(payload.get("testDatetime")),
                stringValue(payload.get("testedAt")));
        if (raw.isBlank()) return Instant.now();
        try {
            return Instant.parse(raw);
        } catch (java.time.format.DateTimeParseException ignored) {
            try {
                return OffsetDateTime.parse(raw).toInstant();
            } catch (java.time.format.DateTimeParseException noOffset) {
                // Existing SQLite rows store UTC timestamps without an offset.
                return LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC);
            }
        }
    }
}
