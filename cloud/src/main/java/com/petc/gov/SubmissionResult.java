package com.petc.gov;

import java.time.LocalDate;

/**
 * Result returned by the gov client after submitting an emission test.
 *
 * Accepted submissions carry the LTMS-issued certificate number plus
 * fields used to render the printed CEC: the OR number visible on the
 * receipt, the DERMALOG cryptographic token (LTMS submission seal),
 * and the validity window (typically 60 days).
 */
public record SubmissionResult(
        String state,            // ACCEPTED | REJECTED
        String certificateNo,    // non-null when ACCEPTED
        String orNo,             // OR No. on the CEC (LTMS receipt number); ACCEPTED only
        String dermalogToken,    // LTMS cryptographic submission seal; ACCEPTED only
        LocalDate validFrom,     // CEC validity start (typically test date); ACCEPTED only
        LocalDate validUntil,    // CEC validity end (typically test date + 60d); ACCEPTED only
        String rejectionReason   // non-null when REJECTED
) {
    public static SubmissionResult accepted(
            String certNo,
            String orNo,
            String dermalogToken,
            LocalDate validFrom,
            LocalDate validUntil
    ) {
        return new SubmissionResult("ACCEPTED", certNo, orNo, dermalogToken, validFrom, validUntil, null);
    }

    public static SubmissionResult rejected(String reason) {
        return new SubmissionResult("REJECTED", null, null, null, null, null, reason);
    }

    public boolean isAccepted() {
        return "ACCEPTED".equals(state);
    }
}
