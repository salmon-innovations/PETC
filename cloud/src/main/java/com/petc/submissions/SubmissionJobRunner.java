package com.petc.submissions;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.gov.EmissionPayload;
import com.petc.gov.GovRegistryClient;
import com.petc.gov.SubmissionResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
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
    private static final int[] BACKOFF_SECONDS = {5, 15, 60, 300, 900};

    private final SubmissionService service;
    private final GovRegistryClient govClient;
    private final ObjectMapper mapper;
    private final int maxAttempts;

    public SubmissionJobRunner(
            SubmissionService service,
            GovRegistryClient govClient,
            ObjectMapper mapper,
            @Value("${petc.submission.max-attempts:5}") int maxAttempts
    ) {
        this.service = service;
        this.govClient = govClient;
        this.mapper = mapper;
        this.maxAttempts = maxAttempts;
    }

    @Scheduled(fixedDelay = 2000)
    public void processPending() {
        List<SubmissionService.PendingSubmission> batch = service.claimPending(BATCH_SIZE);
        for (var sub : batch) {
            process(sub);
        }
    }

    private void process(SubmissionService.PendingSubmission sub) {
        service.markInFlight(sub.id());
        try {
            EmissionPayload payload = toEmissionPayload(sub);
            SubmissionResult result = govClient.submitEmissionResult(payload);
            if (result.isAccepted()) {
                service.markAccepted(sub.id(), result.certificateNo(), null);
            } else {
                // Gov rejections are definitive — do not retry
                service.markRejected(sub.id(), result.rejectionReason());
            }
        } catch (Exception e) {
            log.warn("Submission {} attempt {} failed: {}", sub.id(), sub.attempts(), e.getMessage());
            service.markRetry(sub.id(), sub.attempts(), maxAttempts, BACKOFF_SECONDS);
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
