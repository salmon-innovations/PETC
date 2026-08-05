package com.petc.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    /**
     * Tokens are stored as sha256 hex (see saveRefreshToken), never raw, so the
     * incoming raw token must be hashed the same way to match. Hashing stays in
     * SQL so both sides use one implementation.
     */
    @Query(value = """
            SELECT * FROM refresh_tokens
            WHERE token_hash = encode(sha256(CAST(:token AS bytea)), 'hex')
              AND revoked = false
            """, nativeQuery = true)
    Optional<RefreshToken> findByRawToken(@Param("token") String rawToken);

    @Modifying
    @Query("UPDATE RefreshToken r SET r.revoked = true WHERE r.id = :id")
    void revoke(@Param("id") UUID id);

    @Modifying
    @Query(value = """
            INSERT INTO refresh_tokens(user_id, tenant_id, token_hash, expires_at)
            VALUES (:userId, :tenantId,
                    encode(sha256(CAST(:token AS bytea)), 'hex'),
                    now() + interval '30 days')
            """, nativeQuery = true)
    void saveRefreshToken(
            @Param("userId") UUID userId,
            @Param("tenantId") UUID tenantId,
            @Param("token") String rawToken
    );

    @Modifying
    @Query(value = """
            INSERT INTO refresh_tokens(super_admin_id, token_hash, expires_at)
            VALUES (:superAdminId,
                    encode(sha256(CAST(:token AS bytea)), 'hex'),
                    now() + interval '30 days')
            """, nativeQuery = true)
    void saveSuperAdminRefreshToken(
            @Param("superAdminId") UUID superAdminId,
            @Param("token") String rawToken
    );
}
