package com.petc.ltms;

import org.springframework.jdbc.core.JdbcTemplate;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Objects;
import java.util.Optional;

/** Durable, shared token cache.  The compact JWT is encrypted at rest with AES-256-GCM. */
public final class JdbcLtmsTokenCache implements LtmsTokenCache {
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final int NONCE_BYTES = 12;
    private static final byte[] KEY_CONTEXT = "petc.ltms.token-cache.v1\0".getBytes(StandardCharsets.UTF_8);
    private final JdbcTemplate jdbc;
    private final SecretKeySpec key;
    private final SecureRandom random;

    public JdbcLtmsTokenCache(JdbcTemplate jdbc, String applicationJwtSecret) {
        this(jdbc, applicationJwtSecret, new SecureRandom());
    }

    JdbcLtmsTokenCache(JdbcTemplate jdbc, String applicationJwtSecret, SecureRandom random) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
        if (applicationJwtSecret == null || applicationJwtSecret.isBlank()) {
            throw new IllegalArgumentException("petc.jwt.secret is required for LTMS token encryption");
        }
        this.key = new SecretKeySpec(deriveKey(applicationJwtSecret), "AES");
        this.random = Objects.requireNonNull(random, "random");
    }

    @Override
    public Optional<LtmsTokenRecord> find(LtmsTokenKey key) {
        return jdbc.query("""
                SELECT token_ciphertext, nonce, issued_at, jwt_expires_at
                FROM ltms_token_cache
                WHERE center_id = ? AND environment = ? AND username = ?
                  AND cache_expires_at > now()
                """, rs -> {
            if (!rs.next()) return Optional.empty();
            String token = decrypt(rs.getBytes("nonce"), rs.getBytes("token_ciphertext"), key);
            return Optional.of(new LtmsTokenRecord(key, new ParsedLtmsJwt(token,
                    rs.getObject("issued_at", OffsetDateTime.class).toInstant(),
                    rs.getObject("jwt_expires_at", OffsetDateTime.class).toInstant())));
        }, key.centerId(), key.environment(), key.username());
    }

    @Override
    public void store(LtmsTokenRecord record) {
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        byte[] encrypted = encrypt(record.token().rawToken(), nonce, record.key());
        jdbc.update("""
                INSERT INTO ltms_token_cache (
                    center_id, environment, username, token_ciphertext, nonce,
                    issued_at, jwt_expires_at, cache_expires_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
                ON CONFLICT (center_id, environment, username) DO UPDATE SET
                    token_ciphertext = EXCLUDED.token_ciphertext,
                    nonce = EXCLUDED.nonce,
                    issued_at = EXCLUDED.issued_at,
                    jwt_expires_at = EXCLUDED.jwt_expires_at,
                    cache_expires_at = EXCLUDED.cache_expires_at,
                    updated_at = now()
                """, record.key().centerId(), record.key().environment(), record.key().username(),
                encrypted, nonce,
                OffsetDateTime.ofInstant(record.token().issuedAt(), ZoneOffset.UTC),
                OffsetDateTime.ofInstant(record.token().expiresAt(), ZoneOffset.UTC),
                OffsetDateTime.ofInstant(record.usableUntil(), ZoneOffset.UTC));
    }

    private byte[] encrypt(String token, byte[] nonce, LtmsTokenKey tokenKey) {
        byte[] plaintext = token.getBytes(StandardCharsets.UTF_8);
        try {
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            cipher.updateAAD(aad(tokenKey));
            return cipher.doFinal(plaintext);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to encrypt LTMS token cache", e);
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
    }

    private String decrypt(byte[] nonce, byte[] ciphertext, LtmsTokenKey tokenKey) {
        try {
            if (nonce == null || nonce.length != NONCE_BYTES || ciphertext == null || ciphertext.length == 0) {
                throw new IllegalStateException("LTMS token cache contains an invalid encrypted record");
            }
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            cipher.updateAAD(aad(tokenKey));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("Unable to decrypt LTMS token cache", e);
        }
    }

    private static byte[] deriveKey(String secret) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(KEY_CONTEXT);
            return digest.digest(secret.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("Unable to derive LTMS token encryption key", e);
        }
    }

    private static byte[] aad(LtmsTokenKey key) {
        return (key.centerId() + '\0' + key.environment() + '\0' + key.username()).getBytes(StandardCharsets.UTF_8);
    }
}
