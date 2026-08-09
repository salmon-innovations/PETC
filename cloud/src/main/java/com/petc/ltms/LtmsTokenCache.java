package com.petc.ltms;

import java.util.Optional;

/** Live implementation must be encrypted shared storage; this boundary contains no password. */
public interface LtmsTokenCache {
    Optional<LtmsTokenRecord> find(LtmsTokenKey key);
    void store(LtmsTokenRecord token);
}
