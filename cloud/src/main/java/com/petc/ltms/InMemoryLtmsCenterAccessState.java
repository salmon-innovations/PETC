package com.petc.ltms;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Test/local fake only; live deployments must persist this state per center. */
public final class InMemoryLtmsCenterAccessState implements LtmsCenterAccessState {
    private final ConcurrentHashMap<LtmsTokenKey, String> blocked = new ConcurrentHashMap<>();
    @Override public Optional<String> blockedReason(LtmsTokenKey key) { return Optional.ofNullable(blocked.get(key)); }
    @Override public void block(LtmsTokenKey key, String reason) { blocked.put(key, LtmsRedactor.redact(reason)); }
}
