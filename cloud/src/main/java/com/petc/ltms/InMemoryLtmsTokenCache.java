package com.petc.ltms;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Test/local fake only. It is intentionally not registered as a Spring production bean. */
public final class InMemoryLtmsTokenCache implements LtmsTokenCache {
    private final ConcurrentHashMap<LtmsTokenKey, LtmsTokenRecord> records = new ConcurrentHashMap<>();
    @Override public Optional<LtmsTokenRecord> find(LtmsTokenKey key) { return Optional.ofNullable(records.get(key)); }
    @Override public void store(LtmsTokenRecord token) { records.put(token.key(), token); }
}
