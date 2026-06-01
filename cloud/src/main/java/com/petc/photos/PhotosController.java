package com.petc.photos;

import com.petc.ingest.CenterKeyValidator;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.time.Duration;

/**
 * Issues short-lived S3 presigned PUT URLs so desktop apps can upload
 * photo bytes directly to S3 without routing them through the API server.
 *
 * Authentication: X-Center-Key.
 */
@RestController
@RequestMapping("/api/photos")
public class PhotosController {

    private final CenterKeyValidator keyValidator;
    private final S3Presigner presigner;
    private final String bucket;
    private final int presignTtlSeconds;

    public PhotosController(
            CenterKeyValidator keyValidator,
            S3Presigner presigner,
            @Value("${petc.s3.bucket}") String bucket,
            @Value("${petc.s3.presigned-put-ttl-seconds:300}") int presignTtlSeconds
    ) {
        this.keyValidator = keyValidator;
        this.presigner = presigner;
        this.bucket = bucket;
        this.presignTtlSeconds = presignTtlSeconds;
    }

    /**
     * Returns a presigned PUT URL valid for {@code presignTtlSeconds}.
     * S3 key is scoped to {@code tenants/{tenantId}/tests/{testId}/{photoId}.jpg}.
     */
    @PostMapping("/presign")
    public ResponseEntity<PresignResponse> presign(
            @RequestHeader("X-Center-Key") String centerKey,
            @Valid @RequestBody PresignRequest req
    ) {
        String tenantId = keyValidator.validate(centerKey);
        String s3Key = "tenants/%s/tests/%s/%s.jpg".formatted(tenantId, req.testId(), req.photoId());

        PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
                .signatureDuration(Duration.ofSeconds(presignTtlSeconds))
                .putObjectRequest(PutObjectRequest.builder()
                        .bucket(bucket)
                        .key(s3Key)
                        .contentType(req.contentType() != null ? req.contentType() : "image/jpeg")
                        .build())
                .build();

        PresignedPutObjectRequest presigned = presigner.presignPutObject(presignRequest);

        return ResponseEntity.ok(new PresignResponse(s3Key, presigned.url().toString()));
    }

    // ── records ───────────────────────────────────────────────────────────

    record PresignRequest(
            @NotBlank String testId,
            @NotBlank String photoId,
            String photoType,
            String contentType,
            String sha256
    ) {}

    record PresignResponse(String s3Key, String uploadUrl) {}
}
