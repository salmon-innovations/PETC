package com.petc.ingest;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * Persists mirror events into the cloud Postgres mirror tables.
 * Uses upsert (INSERT … ON CONFLICT DO UPDATE) so replays are idempotent.
 */
@Service
public class MirrorIngestService {

    private static final Logger log = LoggerFactory.getLogger(MirrorIngestService.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public MirrorIngestService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Transactional
    public void ingest(String tenantId, MirrorIngestController.MirrorPayload payload) {
        recordEvent(tenantId, payload);
        switch (payload.entityType()) {
            case "emission_test_started" -> upsertEmissionTestStarted(tenantId, payload);
            case "emission_test_result" -> upsertEmissionTest(tenantId, payload);
            case "test_photo"            -> upsertTestPhoto(tenantId, payload);
            case "ltms_submission"      -> upsertLtmsSubmission(tenantId, payload);
            default -> log.warn("Unknown mirror entity type: {}", payload.entityType());
        }
    }

    private void recordEvent(String tenantId, MirrorIngestController.MirrorPayload p) {
        jdbc.update("""
            INSERT INTO mirror_events
                (tenant_id, center_id, entity_type, entity_id, payload_json)
            VALUES (?::uuid, ?, ?, ?, ?::jsonb)
            """,
            tenantId,
            p.centerId(),
            p.entityType(),
            p.entityId(),
            json(p.payload())
        );
    }

    private void upsertEmissionTestStarted(String tenantId, MirrorIngestController.MirrorPayload p) {
        Map<String, Object> d = p.payload();
        jdbc.update("""
            INSERT INTO mirror_emission_tests
                (id, tenant_id, session_token, plate_number, fuel_type, started_at, last_event_type, last_event_at)
            VALUES (?, ?::uuid, ?, ?, ?, ?::timestamptz, ?, now())
            ON CONFLICT (id) DO UPDATE SET
                session_token   = COALESCE(EXCLUDED.session_token, mirror_emission_tests.session_token),
                plate_number    = COALESCE(EXCLUDED.plate_number, mirror_emission_tests.plate_number),
                fuel_type       = COALESCE(EXCLUDED.fuel_type, mirror_emission_tests.fuel_type),
                started_at      = COALESCE(EXCLUDED.started_at, mirror_emission_tests.started_at),
                last_event_type = EXCLUDED.last_event_type,
                last_event_at   = now()
            """,
            p.entityId(), tenantId,
            str(d, "session_token"), str(d, "plate_number"),
            str(d, "fuel_type"), str(d, "started_at"),
            p.entityType()
        );
    }

    private void upsertEmissionTest(String tenantId, MirrorIngestController.MirrorPayload p) {
        Map<String, Object> d = p.payload();
        jdbc.update("""
            INSERT INTO mirror_emission_tests
                (id, tenant_id, session_token, plate_number, fuel_type, pass_fail, serial_no,
                 captured_at, completed_at, raw_hex, readings_json, photo_count, last_event_type, last_event_at)
            VALUES (?, ?::uuid, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz, ?, ?::jsonb, ?, ?, now())
            ON CONFLICT (id) DO UPDATE SET
                session_token   = COALESCE(EXCLUDED.session_token, mirror_emission_tests.session_token),
                plate_number    = COALESCE(EXCLUDED.plate_number, mirror_emission_tests.plate_number),
                fuel_type       = COALESCE(EXCLUDED.fuel_type, mirror_emission_tests.fuel_type),
                pass_fail       = EXCLUDED.pass_fail,
                serial_no       = COALESCE(EXCLUDED.serial_no, mirror_emission_tests.serial_no),
                captured_at     = EXCLUDED.captured_at,
                completed_at    = EXCLUDED.completed_at,
                raw_hex         = COALESCE(EXCLUDED.raw_hex, mirror_emission_tests.raw_hex),
                readings_json   = EXCLUDED.readings_json,
                photo_count     = GREATEST(EXCLUDED.photo_count, mirror_emission_tests.photo_count),
                last_event_type = EXCLUDED.last_event_type,
                last_event_at   = now()
            """,
            p.entityId(), tenantId,
            str(d, "session_token"), str(d, "plate_number"),
            str(d, "fuel_type"), bool(d, "pass_fail"), str(d, "serial_no"),
            str(d, "captured_at"), str(d, "captured_at"), str(d, "raw"),
            jsonObject(d.get("readings")), intValue(d, "photo_count"), p.entityType()
        );
    }

    private void upsertLtmsSubmission(String tenantId, MirrorIngestController.MirrorPayload p) {
        Map<String, Object> d = p.payload();
        jdbc.update("""
            INSERT INTO mirror_emission_tests
                (id, tenant_id, session_token, fuel_type, last_event_type, last_event_at)
            VALUES (?, ?::uuid, '', 'UNKNOWN', ?, now())
            ON CONFLICT (id) DO NOTHING
            """, str(d, "test_id"), tenantId, p.entityType());
        jdbc.update("""
            INSERT INTO mirror_ltms_submissions
                (id, tenant_id, test_id, state, certificate_no, rejection_reason, submitted_at, payload_json)
            VALUES (?, ?::uuid, ?, ?, ?, ?, ?::timestamptz, ?::jsonb)
            ON CONFLICT (id) DO UPDATE SET
                state          = EXCLUDED.state,
                certificate_no = EXCLUDED.certificate_no,
                rejection_reason = EXCLUDED.rejection_reason,
                submitted_at = COALESCE(EXCLUDED.submitted_at, mirror_ltms_submissions.submitted_at),
                payload_json = EXCLUDED.payload_json
            """,
            p.entityId(), tenantId, str(d, "test_id"), str(d, "state"),
            str(d, "certificate_no"), str(d, "rejection_reason"),
            str(d, "submitted_at"), json(d)
        );
    }

    private void upsertTestPhoto(String tenantId, MirrorIngestController.MirrorPayload p) {
        Map<String, Object> d = p.payload();
        String testId = str(d, "test_id");
        jdbc.update("""
            INSERT INTO mirror_emission_tests
                (id, tenant_id, session_token, fuel_type, last_event_type, last_event_at)
            VALUES (?, ?::uuid, '', 'UNKNOWN', ?, now())
            ON CONFLICT (id) DO NOTHING
            """, testId, tenantId, p.entityType());
        jdbc.update("""
            INSERT INTO mirror_test_photos
                (id, tenant_id, test_id, photo_type, file_path, s3_key, captured_at)
            VALUES (?, ?::uuid, ?, ?, ?, ?, ?::timestamptz)
            ON CONFLICT (id) DO UPDATE SET
                photo_type = EXCLUDED.photo_type,
                file_path = EXCLUDED.file_path,
                s3_key = EXCLUDED.s3_key,
                captured_at = EXCLUDED.captured_at,
                ingested_at = now()
            """,
            p.entityId(), tenantId, testId, str(d, "photo_type"),
            str(d, "file_path"), str(d, "s3_key"), str(d, "captured_at")
        );
        jdbc.update("""
            UPDATE mirror_emission_tests
            SET photo_count = (
                    SELECT COUNT(*)
                    FROM mirror_test_photos
                    WHERE test_id = ?
                ),
                last_event_type = ?,
                last_event_at = now()
            WHERE id = ?
            """, testId, p.entityType(), testId);
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value != null ? value : Map.of());
        } catch (Exception e) {
            throw new IllegalArgumentException("Unable to serialize mirror payload", e);
        }
    }

    private String jsonObject(Object value) {
        if (value instanceof Map<?, ?>) {
            return json(value);
        }
        return "{}";
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v != null ? v.toString() : null;
    }

    private static Boolean bool(Map<String, Object> m, String k) {
        Object v = m.get(k);
        if (v instanceof Boolean b) return b;
        if (v instanceof String s) return Boolean.parseBoolean(s);
        return null;
    }

    private static Integer intValue(Map<String, Object> m, String k) {
        Object v = m.get(k);
        if (v instanceof Number n) return n.intValue();
        if (v instanceof String s && !s.isBlank()) return Integer.parseInt(s);
        return 0;
    }
}
