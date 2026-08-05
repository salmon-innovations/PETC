package com.petc.audit;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.Instant;

@Service
public class AuditService {

    private final JdbcTemplate jdbc;

    public AuditService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Async
    public void record(String tenantId, String userId, String action, String entityType, String entityId) {
        jdbc.update("""
                INSERT INTO audit_log(tenant_id, user_id, action, entity_type, entity_id, occurred_at)
                VALUES (?::uuid, ?::uuid, ?, ?, ?, ?::timestamptz)
                """,
                tenantId, userId, action, entityType, entityId, Instant.now().toString()
        );
    }
}
