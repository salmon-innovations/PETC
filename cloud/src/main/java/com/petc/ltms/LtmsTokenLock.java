package com.petc.ltms;

import java.util.function.Supplier;

/** Must be distributed (for example, DB advisory/row lock) in ECS production. */
public interface LtmsTokenLock {
    <T> T withLock(LtmsTokenKey key, Supplier<T> action);
}
