package com.petc.ltms;

import java.time.Duration;
import java.time.Instant;

/** Encrypted persistence is supplied behind the cache interface in live deployments. */
public record LtmsTokenRecord(LtmsTokenKey key, ParsedLtmsJwt token) {
    /** LTMS has advised a 24-hour JWT life.  Never retain a token beyond that cap. */
    public static final Duration MAX_CACHE_LIFETIME = Duration.ofHours(24);

    public Instant usableUntil() {
        Instant capped = token.issuedAt().plus(MAX_CACHE_LIFETIME);
        return token.expiresAt().isBefore(capped) ? token.expiresAt() : capped;
    }

    public boolean usableAt(Instant now, Duration refreshLead) {
        return usableUntil().isAfter(now.plus(refreshLead));
    }
    @Override public String toString() { return "LtmsTokenRecord[key=" + key + ", token=" + token + "]"; }
}
