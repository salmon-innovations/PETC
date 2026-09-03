package com.petc.billing;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class BillingServiceTest {
    @Test
    void firstHalfEndsAtStartOfSixteenthInManila() {
        var window = BillingService.containing(
                Instant.parse("2026-08-15T15:59:59Z"), BillingService.DEFAULT_ZONE);

        assertThat(window.start()).isEqualTo(Instant.parse("2026-07-31T16:00:00Z"));
        assertThat(window.end()).isEqualTo(Instant.parse("2026-08-15T16:00:00Z"));
    }

    @Test
    void exactSixteenthStartsSecondHalf() {
        var window = BillingService.containing(
                Instant.parse("2026-08-15T16:00:00Z"), BillingService.DEFAULT_ZONE);

        assertThat(window.start()).isEqualTo(Instant.parse("2026-08-15T16:00:00Z"));
        assertThat(window.end()).isEqualTo(Instant.parse("2026-08-31T16:00:00Z"));
    }

    @Test
    void februarySecondHalfEndsAtCalendarMonthBoundary() {
        var window = BillingService.containing(
                Instant.parse("2028-02-28T04:00:00Z"), BillingService.DEFAULT_ZONE);

        assertThat(window.end()).isEqualTo(Instant.parse("2028-02-29T16:00:00Z"));
    }
}
