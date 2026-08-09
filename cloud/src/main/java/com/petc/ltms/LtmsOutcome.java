package com.petc.ltms;

/** A retry decision is based on this catalog, never HTTP status alone. */
public enum LtmsOutcome {
    SUCCESS,
    AUTH_REFRESH_ONCE,
    REUSE_CACHED_TOKEN,
    AUTH_BLOCKED,
    MISSING_PRIVILEGE,
    DEFER_TO_NEXT_DAY,
    DEFER,
    FAILED_EVALUATION,
    RECONCILE,
    ACTION_REQUIRED,
    INVALID_REQUEST,
    UNKNOWN
}
