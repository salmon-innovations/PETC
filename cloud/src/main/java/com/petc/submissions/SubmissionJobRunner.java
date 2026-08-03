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
            boolean accepted = process(sub);
            if (accepted && charge > 0) {
                if (remainingBefore != null) {
                    projected.put(sub.tenantId(), remainingBefore - charge);
                } else {
                    // A grace-released acceptance still debits its quote. If
                    // this tenant already has a running batch projection, keep
                    // that projection aligned with the now-lower balance.
                    projected.computeIfPresent(sub.tenantId(), (ignored, value) -> value - charge);
                }
            }
        }
    }

    /** Returns true only when LTMS accepted and the quoted charge was applied. */
    private boolean process(SubmissionService.PendingSubmission sub) {
        service.markInFlight(sub.id());
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
                        result.validUntil()
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
                    (String) payload.getOrDefault("plateNumber", ""),
                    (String) payload.getOrDefault("licenseNo", ""),
                    (String) payload.getOrDefault("fuelType", "GAS"),
                    Boolean.TRUE.equals(payload.get("passFail")),
                    readings,
                    photos,
                    (String) payload.getOrDefault("operatorId", ""),
                    sub.tenantId(),
                    Instant.now()
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to deserialise submission payload for " + sub.id(), e);
        }
    }
}
