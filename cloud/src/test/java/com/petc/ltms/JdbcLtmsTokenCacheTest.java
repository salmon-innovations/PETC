package com.petc.ltms;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;

class JdbcLtmsTokenCacheTest {
    @Test void storesOnlyCiphertextAndCapsThePersistedLifetimeAtTwentyFourHours() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        JdbcLtmsTokenCache cache = new JdbcLtmsTokenCache(jdbc, "a-safe-application-secret-with-enough-entropy");
        Instant issued = Instant.parse("2026-01-01T00:00:00Z");
        LtmsTokenRecord record = new LtmsTokenRecord(new LtmsTokenKey("center", "PRODUCTION", "user"),
                new ParsedLtmsJwt("header.payload.signature", issued, issued.plusSeconds(48 * 60 * 60)));

        cache.store(record);

        Object[] allArguments = mockingDetails(jdbc).getInvocations().stream()
                .filter(invocation -> invocation.getMethod().getName().equals("update"))
                .findFirst().orElseThrow().getArguments();
        Object[] persisted = java.util.Arrays.copyOfRange(allArguments, 1, allArguments.length);
        byte[] ciphertext = (byte[]) persisted[3];
        assertFalse(java.util.Arrays.equals("header.payload.signature".getBytes(java.nio.charset.StandardCharsets.UTF_8), ciphertext));
        assertNotEquals("header.payload.signature", new String(ciphertext, java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(issued.plusSeconds(24 * 60 * 60), ((java.time.OffsetDateTime) persisted[7]).toInstant());
    }
}
