package com.petc.ltms;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * Per-center token lifecycle. The lock is acquired only after the fast cache
 * lookup, then the cache is checked again inside the critical section.
 */
public final class LtmsTokenManager {
    private final LtmsTokenCache cache;
    private final LtmsTokenLock lock;
    private final LtmsCenterAccessState accessState;
    private final LtmsJwtClient jwtClient;
    private final LtmsJwtParser parser;
    private final Clock clock;
    private final Duration refreshLead;

    public LtmsTokenManager(
            LtmsTokenCache cache,
            LtmsTokenLock lock,
            LtmsCenterAccessState accessState,
            LtmsJwtClient jwtClient,
            LtmsJwtParser parser,
            Clock clock,
            Duration refreshLead
    ) {
        this.cache = cache;
        this.lock = lock;
        this.accessState = accessState;
        this.jwtClient = jwtClient;
        this.parser = parser;
        this.clock = clock;
        this.refreshLead = refreshLead == null ? Duration.ZERO : refreshLead;
    }

    public ParsedLtmsJwt getOrAcquire(LtmsCredentials credentials) {
        LtmsTokenKey key = credentials.key();
        ensureNotBlocked(key);
        Optional<ParsedLtmsJwt> cached = usableCached(key, refreshLead);
        if (cached.isPresent()) return cached.get();
        return lock.withLock(key, () -> {
            ensureNotBlocked(key);
            return usableCached(key, refreshLead).orElseGet(() -> authenticateAndStoreOrReuse(credentials));
        });
    }

    /** Used only for the one allowed recovery from LTMS error 311. */
    public ParsedLtmsJwt refreshOnce(LtmsCredentials credentials) {
        LtmsTokenKey key = credentials.key();
        ensureNotBlocked(key);
        return lock.withLock(key, () -> {
            ensureNotBlocked(key);
            return authenticateAndStoreOrReuse(credentials);
        });
    }

    /** Error 312 is not a reason to try authentication again; LTMS still has our existing token. */
    private ParsedLtmsJwt authenticateAndStoreOrReuse(LtmsCredentials credentials) {
        try {
            return authenticateAndStore(credentials);
        } catch (LtmsRemoteException error) {
            if (error.outcome() == LtmsOutcome.REUSE_CACHED_TOKEN) {
                return usableCached(credentials.key(), Duration.ZERO).orElseThrow(() -> error);
            }
            throw error;
        }
    }

    private ParsedLtmsJwt authenticateAndStore(LtmsCredentials credentials) {
        try {
            ParsedLtmsJwt token = parser.parseForScheduling(jwtClient.authenticate(credentials));
            cache.store(new LtmsTokenRecord(credentials.key(), token));
            return token;
        } catch (LtmsRemoteException error) {
            if (error.outcome() == LtmsOutcome.AUTH_BLOCKED || error.outcome() == LtmsOutcome.MISSING_PRIVILEGE) {
                accessState.block(credentials.key(), "LTMS error " + error.errorCode());
            }
            throw error;
        }
    }

    private Optional<ParsedLtmsJwt> usableCached(LtmsTokenKey key, Duration lead) {
        Instant now = clock.instant();
        return cache.find(key).filter(record -> record.usableAt(now, lead)).map(LtmsTokenRecord::token);
    }

    private void ensureNotBlocked(LtmsTokenKey key) {
        accessState.blockedReason(key).ifPresent(reason -> { throw new LtmsCenterBlockedException(reason); });
    }
}
