package com.petc.ltms;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class LtmsCecNumberAllocatorTest {
    @Test
    void formatsCurrentYearFiveDigitPetcCodeSeparatorAndSixDigitSequence() {
        var allocation = LtmsCecNumberAllocator.format(2026, "3012", 42, 6);

        assertThat(allocation.cecNumber()).isEqualTo("2026030120000042");
        assertThat(allocation.orNumber()).isEqualTo("000042");
    }

    @Test
    void rejectsUnknownPetcCodesAndExhaustedSequences() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> LtmsCecNumberAllocator.format(2026, "PETC", 1, 6));
        assertThatIllegalStateException()
                .isThrownBy(() -> LtmsCecNumberAllocator.format(2026, "12345", 1_000_000, 6));
    }
}
