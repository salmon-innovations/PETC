package com.petc.ltms;

import java.util.Optional;

/** Persists account-lock/credential-block state separately from the token cache. */
public interface LtmsCenterAccessState {
    Optional<String> blockedReason(LtmsTokenKey key);
    void block(LtmsTokenKey key, String reason);
}
