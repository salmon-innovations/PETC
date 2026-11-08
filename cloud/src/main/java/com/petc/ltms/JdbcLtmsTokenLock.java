package com.petc.ltms;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Objects;
import java.util.function.Supplier;

/** PostgreSQL transaction advisory lock, shared by every application instance. */
public final class JdbcLtmsTokenLock implements LtmsTokenLock {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    public JdbcLtmsTokenLock(JdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
        this.transactions = new TransactionTemplate(Objects.requireNonNull(transactionManager, "transactionManager"));
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public <T> T withLock(LtmsTokenKey key, Supplier<T> action) {
        return transactions.execute(status -> {
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)", (rs, rowNum) -> null, lockId(key));
            return action.get();
        });
    }

    static long lockId(LtmsTokenKey key) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(("petc.ltms.token-lock.v1\0" + key.centerId() + '\0' + key.environment() + '\0' + key.username())
                            .getBytes(StandardCharsets.UTF_8));
            return ByteBuffer.wrap(hash).getLong();
        } catch (Exception e) {
            throw new IllegalStateException("Unable to create LTMS token lock key", e);
        }
    }
}
