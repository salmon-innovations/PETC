package com.petc.ltms;

import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;

/** Shared stop-state so a blocked LTMS account is not retried by another ECS task. */
public final class JdbcLtmsCenterAccessState implements LtmsCenterAccessState {
    private final JdbcTemplate jdbc;

    public JdbcLtmsCenterAccessState(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Override
    public Optional<String> blockedReason(LtmsTokenKey key) {
        List<String> states = jdbc.query("""
                SELECT credential_verification_state
                FROM ltms_center_configs
                WHERE center_id = ? AND ltms_username = ? AND environment = ?
                  AND credential_verification_state IN ('ACCOUNT_LOCKED', 'INVALID_CREDENTIALS', 'MISSING_PRIVILEGE')
                """, (rs, rowNum) -> rs.getString(1), key.centerId(), key.username(), key.environment());
        return states.stream().findFirst().map(state -> "LTMS access blocked: " + state);
    }

    @Override
    public void block(LtmsTokenKey key, String reason) {
        String state = reason != null && (reason.contains("301") || reason.contains("321"))
                ? "MISSING_PRIVILEGE" : "ACCOUNT_LOCKED";
        jdbc.update("""
                UPDATE ltms_center_configs
                   SET credential_verification_state = ?, updated_at = now()
                 WHERE center_id = ? AND ltms_username = ? AND environment = ?
                """, state, key.centerId(), key.username(), key.environment());
    }
}
