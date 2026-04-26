package com.petc.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    @Query("SELECT r FROM RefreshToken r WHERE r.tokenHash = :hash AND r.revoked = false")
    Optional<RefreshToken> findByTokenHash(@Param("hash") String tokenHash);

    @Modifying
    @Query("UPDATE RefreshToken r SET r.revoked = true WHERE r.id = :id")
    void revoke(@Param("id") UUID id);

    @Query(value = """
            INSERT INTO refresh_tokens(user_id, tenant_id, token_hash, expires_at)
            VALUES (:userId, :tenantId,
                    encode(sha256(:token::bytea), 'hex'),
                    now() + interval '30 days')
            """, nativeQuery = true)
    void saveRefreshToken(
            @Param("userId") UUID userId,
            @Param("tenantId") UUID tenantId,
            @Param("token") String rawToken
    );
}
