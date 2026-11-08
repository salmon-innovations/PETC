package com.petc.ltms;

import java.time.Instant;

/** Claims are decoded only for expiry scheduling; JWT signature validation belongs to LTMS. */
public record ParsedLtmsJwt(String rawToken, Instant issuedAt, Instant expiresAt) {
    public ParsedLtmsJwt {
        if (rawToken == null || rawToken.isBlank() || issuedAt == null || expiresAt == null || !expiresAt.isAfter(issuedAt)) {
            throw new IllegalArgumentException("LTMS JWT must contain ordered iat and exp claims");
        }
    }
    @Override public String toString() { return "ParsedLtmsJwt[rawToken=[REDACTED], issuedAt=" + issuedAt + ", expiresAt=" + expiresAt + "]"; }
}
