package com.petc.ltms;

/** Prevents automated retries against a center LTMS account that needs operator action. */
public final class LtmsCenterBlockedException extends IllegalStateException {
    public LtmsCenterBlockedException(String reason) { super("LTMS calls are blocked for this center: " + LtmsRedactor.redact(reason)); }
}
