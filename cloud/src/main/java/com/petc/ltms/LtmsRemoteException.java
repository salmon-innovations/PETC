package com.petc.ltms;

/** A safe, code-aware LTMS failure. Raw response content is intentionally excluded. */
public final class LtmsRemoteException extends RuntimeException {
    private final Integer errorCode;
    private final LtmsOutcome outcome;
    private final String inboxId;

    public LtmsRemoteException(String message, Integer errorCode, String inboxId) {
        super(LtmsRedactor.redact(message));
        this.errorCode = errorCode;
        this.outcome = LtmsErrorCodeCatalog.classify(errorCode);
        this.inboxId = inboxId;
    }
    public Integer errorCode() { return errorCode; }
    public LtmsOutcome outcome() { return outcome; }
    public String inboxId() { return inboxId; }
}
