package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class LtmsTokenManagerTest {
    private static final Clock CLOCK = Clock.fixed(Instant.ofEpochSecond(1_700_000_100L), ZoneOffset.UTC);

    @Test void concurrentWorkersAcquireOnlyOneTokenForTheSameCenter() throws Exception {
        AtomicInteger authenticationCalls = new AtomicInteger();
        LtmsTokenManager manager = manager(credentials -> {
            authenticationCalls.incrementAndGet();
            return fixtureJwt();
        });
        LtmsCredentials credentials = credentials();
        ExecutorService workers = Executors.newFixedThreadPool(12);
        CountDownLatch start = new CountDownLatch(1);
        List<java.util.concurrent.Future<ParsedLtmsJwt>> futures = new ArrayList<>();
        for (int i = 0; i < 12; i++) futures.add(workers.submit(() -> { start.await(); return manager.getOrAcquire(credentials); }));
        start.countDown();
        for (var future : futures) assertEquals(Instant.ofEpochSecond(1_700_003_600L), future.get(2, TimeUnit.SECONDS).expiresAt());
        workers.shutdownNow();
        assertEquals(1, authenticationCalls.get());
    }

    @Test void parsesRawJwtOnlyForExpiryScheduling() {
        ParsedLtmsJwt token = new LtmsJwtParser(new ObjectMapper()).parseForScheduling(fixtureJwt());
        assertEquals(Instant.ofEpochSecond(1_700_000_000L), token.issuedAt());
        assertEquals(Instant.ofEpochSecond(1_700_003_600L), token.expiresAt());
        assertFalse(token.toString().contains(fixtureJwt()));
    }

    @Test void acceptsTheRawCompactJwtShapeSuppliedByLtms() throws Exception {
        assertEquals(fixtureJwt(), HttpLtmsJwtClient.extractRawToken(new ObjectMapper(), fixtureJwt()));
        assertEquals(fixtureJwt(), HttpLtmsJwtClient.extractRawToken(new ObjectMapper(), "\"" + fixtureJwt() + "\""));
    }

    @Test void accountLockCodeBlocksSubsequentAuthenticationAttempts() {
        AtomicInteger calls = new AtomicInteger();
        LtmsTokenManager manager = manager(credentials -> {
            calls.incrementAndGet();
            throw new LtmsRemoteException("locked", 310, "inbox");
        });
        assertThrows(LtmsRemoteException.class, () -> manager.getOrAcquire(credentials()));
        assertThrows(LtmsCenterBlockedException.class, () -> manager.getOrAcquire(credentials()));
        assertEquals(1, calls.get());
    }

    @Test void cacheLifetimeIsCappedAtTwentyFourHoursFromIssuedAt() {
        ParsedLtmsJwt longLived = new ParsedLtmsJwt("raw", CLOCK.instant().minus(Duration.ofHours(2)), CLOCK.instant().plus(Duration.ofDays(7)));
        LtmsTokenRecord record = new LtmsTokenRecord(credentials().key(), longLived);
        assertEquals(longLived.issuedAt().plus(Duration.ofHours(24)), record.usableUntil());
        assertTrue(record.usableAt(CLOCK.instant().plus(Duration.ofHours(21)), Duration.ZERO));
        assertFalse(record.usableAt(CLOCK.instant().plus(Duration.ofHours(22)), Duration.ZERO));
    }

    @Test void error312ReusesCacheAndDoesNotTryToAuthenticateAgain() {
        AtomicInteger calls = new AtomicInteger();
        InMemoryLtmsTokenCache cache = new InMemoryLtmsTokenCache();
        LtmsCredentials credentials = credentials();
        ParsedLtmsJwt cached = new LtmsJwtParser(new ObjectMapper()).parseForScheduling(fixtureJwt());
        cache.store(new LtmsTokenRecord(credentials.key(), cached));
        LtmsTokenManager manager = new LtmsTokenManager(cache, new InMemoryLtmsTokenLock(), new InMemoryLtmsCenterAccessState(), ignored -> {
            calls.incrementAndGet();
            throw new LtmsRemoteException("already issued", 312, "inbox");
        }, new LtmsJwtParser(new ObjectMapper()), CLOCK, Duration.ofHours(2));

        assertEquals(cached.rawToken(), manager.refreshOnce(credentials).rawToken());
        assertEquals(1, calls.get());
    }

    private static LtmsTokenManager manager(LtmsJwtClient client) {
        return new LtmsTokenManager(new InMemoryLtmsTokenCache(), new InMemoryLtmsTokenLock(), new InMemoryLtmsCenterAccessState(), client,
                new LtmsJwtParser(new ObjectMapper()), CLOCK, Duration.ZERO);
    }
    private static LtmsCredentials credentials() { return new LtmsCredentials(new LtmsTokenKey("center-1", "qa", "user-1"), "password".toCharArray()); }
    private static String fixtureJwt() {
        try (InputStream input = LtmsTokenManagerTest.class.getResourceAsStream("/fixtures/ltms/jwt.txt")) {
            assertNotNull(input); return new String(input.readAllBytes(), StandardCharsets.UTF_8).trim();
        } catch (Exception e) { throw new AssertionError(e); }
    }
}
