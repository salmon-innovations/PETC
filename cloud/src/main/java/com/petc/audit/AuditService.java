package com.petc.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * Writes the cloud-side audit trail.
 *
 * Action names mirror the desktop sidecar's convention (see the _audit() helper
 * in desktop/sidecar/petc/api/server.py) so the two trails read alike:
 * SCREAMING_SNAKE verbs scoped by entity, e.g. SUBMISSION_ACCEPTED, CEC_PRINT.
 *
 * Actors come in three kinds and audit_log records them differently:
 *   - center user   -> user_id (FK to users)
 *   - super admin   -> super_admin_id (FK to super_admin_users); super admins
 *                      are NOT in users, so user_id cannot represent them
 *   - the scheduler -> both FKs null, actor_label 'system'
 *
 * actor_label always carries a human-readable actor so the trail stays readable
 * without a join, and survives the actor row being deleted.
 */
@Service
public class AuditService {

    /** Actor label for rows written by background jobs with no human actor. */
    public static final String SYSTEM_ACTOR = "system";

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public AuditService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /** Audit an action taken by a super admin from the operator portal. */
    public void recordSuperAdmin(
            String superAdminId,
            String actorLabel,
            String tenantId,
            String action,
            String entityType,
            String entityId,
            Map<String, Object> detail
    ) {
        insert(null, superAdminId, actorLabel, tenantId, action, entityType, entityId, detail);
    }

    /** Audit an action taken by a background job (charge, block, grace release). */
    public void recordSystem(
            String tenantId,
            String action,
            String entityType,
            String entityId,
            Map<String, Object> detail
    ) {
        insert(null, null, SYSTEM_ACTOR, tenantId, action, entityType, entityId, detail);
    }

    private void insert(
            String userId,
            String superAdminId,
            String actorLabel,
            String tenantId,
            String action,
            String entityType,
            String entityId,
            Map<String, Object> detail
    ) {
        try {
            String detailJson = detail == null ? null : mapper.writeValueAsString(detail);
            jdbc.update("""
                    INSERT INTO audit_log
                        (user_id, super_admin_id, actor_label, tenant_id,
                         action, entity_type, entity_id, detail)
                    VALUES (?::uuid, ?::uuid, ?, ?::uuid, ?, ?, ?, ?::jsonb)
                    """,
                    userId, superAdminId, actorLabel, tenantId,
                    action, entityType, entityId, detailJson);
        } catch (Exception e) {
            // Audit is a record of what happened, not a precondition for it.
            // A failed audit write must never roll back or block the business
            // action that succeeded — log loudly and carry on.
            log.error("Failed to write audit row action={} entity={}/{}: {}",
                    action, entityType, entityId, e.getMessage(), e);
        }
    }
}
