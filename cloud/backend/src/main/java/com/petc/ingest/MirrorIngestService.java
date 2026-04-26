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
        switch (payload.entityType()) {
            case "emission_test_result" -> upsertEmissionTest(tenantId, payload);
            case "ltms_submission"      -> upsertLtmsSubmission(tenantId, payload);
            default -> log.warn("Unknown mirror entity type: {}", payload.entityType());
        }
    }

    private void upsertEmissionTest(String tenantId, MirrorIngestController.MirrorPayload p) {
        Map<String, Object> d = p.payload();
        jdbc.update("""
            INSERT INTO mirror_emission_tests
                (id, tenant_id, session_token, fuel_type, pass_fail, serial_no, captured_at, raw_hex)
            VALUES (?, ?, ?, ?, ?, ?, ?::timestamptz, ?)
            ON CONFLICT (id) DO UPDATE SET
                pass_fail   = EXCLUDED.pass_fail,
                captured_at = EXCLUDED.captured_at
            """,
            p.entityId(), tenantId,
            str(d, "session_token"), str(d, "fuel_type"),
            bool(d, "pass_fail"),    str(d, "serial_no"),
            str(d, "captured_at"),   str(d, "raw")
        );
    }

    private void upsertLtmsSubmission(String tenantId, MirrorIngestController.MirrorPayload p) {
        Map<String, Object> d = p.payload();
        jdbc.update("""
            INSERT INTO mirror_ltms_submissions
                (id, tenant_id, test_id, state, certificate_no)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                state          = EXCLUDED.state,
                certificate_no = EXCLUDED.certificate_no
            """,
            p.entityId(), tenantId,
            str(d, "test_id"), str(d, "state"), str(d, "certificate_no")
        );
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
}
