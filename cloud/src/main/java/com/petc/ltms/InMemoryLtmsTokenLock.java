package com.petc.ltms;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Test/local fake modelling the required per-key critical section. */
public final class InMemoryLtmsTokenLock implements LtmsTokenLock {
    private final ConcurrentHashMap<LtmsTokenKey, ReentrantLock> locks = new ConcurrentHashMap<>();
    @Override public <T> T withLock(LtmsTokenKey key, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(key, ignored -> new ReentrantLock());
        lock.lock();
        try { return action.get(); } finally { lock.unlock(); }
    }
}
