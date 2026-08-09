package com.petc.ltms;

import java.time.Duration;
import java.time.Instant;

/** Encrypted persistence is supplied behind the cache interface in live deployments. */
public record LtmsTokenRecord(LtmsTokenKey key, ParsedLtmsJwt token) {
    public boolean usableAt(Instant now, Duration refreshLead) {
        return token.expiresAt().isAfter(now.plus(refreshLead));
    }
    @Override public String toString() { return "LtmsTokenRecord[key=" + key + ", token=" + token + "]"; }
}
