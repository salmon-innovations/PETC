package com.petc.gov;

public record SubmissionResult(
        String state,           // ACCEPTED | REJECTED
        String certificateNo,   // non-null when ACCEPTED
        String rejectionReason  // non-null when REJECTED
) {
    public static SubmissionResult accepted(String certNo) {
        return new SubmissionResult("ACCEPTED", certNo, null);
    }

    public static SubmissionResult rejected(String reason) {
        return new SubmissionResult("REJECTED", null, reason);
    }

    public boolean isAccepted() {
        return "ACCEPTED".equals(state);
    }
}
