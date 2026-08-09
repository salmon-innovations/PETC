package com.petc.ltms;

/** Raised before any network client is used when LTMS commissioning is disabled. */
public final class LtmsDisabledException extends IllegalStateException {
    public LtmsDisabledException() { super("LTMS outbound calls are disabled by configuration"); }
}
