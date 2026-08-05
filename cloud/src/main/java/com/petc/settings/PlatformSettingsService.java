package com.petc.settings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Runtime-mutable platform configuration, backed by the platform_settings table.
 *
 * SubmissionJobRunner ticks every 2s and reads the charge rate and backoff
 * ladder on every tick, so this is cached rather than queried each time: a
 * volatile snapshot refreshed on a timer and invalidated eagerly on write, so
 * portal edits take effect immediately while the steady state costs nothing.
 *
 * Every accessor falls back to the value that was hardcoded before this table
 * existed. A missing or corrupt row therefore degrades to previous behaviour
 * instead of throwing inside the scheduler, where an exception would stall the
 * submission queue.
 */
@Service
public class PlatformSettingsService {

    public static final String CHARGE_PER_UPLOAD = "wallet.charge_per_upload_centavos";
    public static final String LOW_BALANCE_THRESHOLD = "wallet.low_balance_threshold_centavos";
    public static final String GRACE_RELEASE_MINUTES = "wallet.grace_release_minutes";
    public static final String DEBT_FLOOR = "wallet.debt_floor_centavos";
    public static final String MAX_ATTEMPTS = "submission.max_attempts";
    public static final String BACKOFF_SECONDS = "submission.backoff_seconds";

    /** Fallbacks match the pre-V6 hardcoded values. */
    private static final long DEFAULT_CHARGE = 8000L;
    private static final long DEFAULT_LOW_BALANCE = 40000L;
    private static final int DEFAULT_GRACE_MINUTES = 120;
    private static final long DEFAULT_DEBT_FLOOR = -500000L;
    private static final int DEFAULT_MAX_ATTEMPTS = 5;
    private static final int[] DEFAULT_BACKOFF = {5, 15, 60, 300, 900};

    private static final Logger log = LoggerFactory.getLogger(PlatformSettingsService.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final AuditService audit;

    private volatile Map<String, JsonNode> cache = Map.of();

    public PlatformSettingsService(JdbcTemplate jdbc, ObjectMapper mapper, AuditService audit) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.audit = audit;
        reload();
    }

    // ---------------------------------------------------------------- reads

    public long chargePerUploadCentavos() {
        return asLong(CHARGE_PER_UPLOAD, DEFAULT_CHARGE);
    }

    public long lowBalanceThresholdCentavos() {
        return asLong(LOW_BALANCE_THRESHOLD, DEFAULT_LOW_BALANCE);
    }

    public int graceReleaseMinutes() {
        return (int) asLong(GRACE_RELEASE_MINUTES, DEFAULT_GRACE_MINUTES);
    }

    /**
     * Debt floor in centavos (negative). Grace release stops below this, so a
     * center this far in arrears keeps its submissions held.
     */
    public long debtFloorCentavos() {
        return asLong(DEBT_FLOOR, DEFAULT_DEBT_FLOOR);
    }

    public int maxAttempts() {
        return (int) asLong(MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
    }

    public int[] backoffSeconds() {
        JsonNode node = cache.get(BACKOFF_SECONDS);
        if (node == null || !node.isArray() || node.isEmpty()) {
            return DEFAULT_BACKOFF.clone();
        }
        int[] out = new int[node.size()];
        for (int i = 0; i < node.size(); i++) {
            out[i] = node.get(i).asInt();
        }
        return out;
    }

    public Map<String, Object> asMap() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put(CHARGE_PER_UPLOAD, chargePerUploadCentavos());
        out.put(LOW_BALANCE_THRESHOLD, lowBalanceThresholdCentavos());
        out.put(GRACE_RELEASE_MINUTES, graceReleaseMinutes());
        out.put(DEBT_FLOOR, debtFloorCentavos());
        out.put(MAX_ATTEMPTS, maxAttempts());
        out.put(BACKOFF_SECONDS, backoffSeconds());
        return out;
    }

    // ---------------------------------------------------------------- writes

    /**
     * Applies a partial settings update. Values are validated before any write,
     * so a rejected payload leaves the live configuration untouched rather than
     * half-applied.
     */
    @Transactional
    public void update(Map<String, Object> updates, String superAdminId, String actorLabel) {
        Map<String, Object> before = asMap();
        List<String> errors = validate(updates);
        if (!errors.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, String.join("; ", errors));
        }

        for (var entry : updates.entrySet()) {
            try {
                String json = mapper.writeValueAsString(entry.getValue());
                int updated = jdbc.update("""
                        UPDATE platform_settings
                           SET value = ?::jsonb, updated_at = now(), updated_by = ?
                         WHERE key = ?
                        """, json, actorLabel, entry.getKey());
                if (updated == 0) {
                    throw new ResponseStatusException(
                            HttpStatus.BAD_REQUEST, "Unknown setting: " + entry.getKey());
                }
            } catch (ResponseStatusException e) {
                throw e;
            } catch (Exception e) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "Invalid value for " + entry.getKey());
            }
        }

        reload();

        audit.recordSuperAdmin(superAdminId, actorLabel, null,
                "SETTINGS_CHANGED", "platform_settings", null,
                Map.of("before", before, "after", asMap()));
    }

    /**
     * Rejects values that would break the submission pipeline. The scheduler
     * reads these every 2s, so a zero backoff or a zero attempt limit is a
     * production incident, not a bad form entry.
     */
    private List<String> validate(Map<String, Object> updates) {
        List<String> errors = new ArrayList<>();
        for (var entry : updates.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            switch (key) {
                case CHARGE_PER_UPLOAD, LOW_BALANCE_THRESHOLD -> {
                    if (!(value instanceof Number n) || n.longValue() < 0) {
                        errors.add(key + " must be a non-negative integer (centavos)");
                    }
                }
                case DEBT_FLOOR -> {
                    if (!(value instanceof Number n) || n.longValue() > 0) {
                        errors.add(key + " must be zero or negative (centavos of debt)");
                    }
                }
                case GRACE_RELEASE_MINUTES -> {
                    if (!(value instanceof Number n) || n.intValue() < 1) {
                        errors.add(key + " must be at least 1 minute");
                    }
                }
                case MAX_ATTEMPTS -> {
                    if (!(value instanceof Number n) || n.intValue() < 1 || n.intValue() > 20) {
                        errors.add(key + " must be between 1 and 20");
                    }
                }
                case BACKOFF_SECONDS -> {
                    if (!(value instanceof List<?> list) || list.isEmpty() || list.size() > 20) {
                        errors.add(key + " must be a non-empty array of at most 20 entries");
                    } else if (list.stream().anyMatch(v -> !(v instanceof Number n) || n.intValue() < 1)) {
                        errors.add(key + " entries must all be positive integers (seconds)");
                    }
                }
                default -> errors.add("Unknown setting: " + key);
            }
        }
        return errors;
    }

    // ---------------------------------------------------------------- cache

    /**
     * Periodic refresh so a change made directly in the database (or by another
     * instance) is picked up. Portal writes call reload() directly, so this
     * interval is a backstop, not the primary path.
     */
    @Scheduled(fixedDelay = 30_000)
    public void reload() {
        try {
            Map<String, JsonNode> loaded = new HashMap<>();
            jdbc.query("SELECT key, value FROM platform_settings", rs -> {
                try {
                    loaded.put(rs.getString("key"), mapper.readTree(rs.getString("value")));
                } catch (Exception e) {
                    log.warn("Unparseable platform_settings row key={} — using fallback", rs.getString("key"));
                }
            });
            cache = Map.copyOf(loaded);
        } catch (Exception e) {
            // Keep serving the previous snapshot rather than dropping to
            // defaults on a transient DB blip.
            log.error("Failed to reload platform settings, keeping cached values: {}", e.getMessage());
        }
    }

    private long asLong(String key, long fallback) {
        JsonNode node = cache.get(key);
        return node == null || !node.isNumber() ? fallback : node.asLong();
    }
}
