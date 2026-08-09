package com.petc.ltms;

import java.util.Objects;

/** Trusted, server-derived LTMS identity. Never build this from desktop input. */
public record LtmsRequestContext(String username, String businessId, String rawJwt) {
    public LtmsRequestContext {
        require(username, "username");
        require(businessId, "businessId");
        require(rawJwt, "rawJwt");
    }

    private static void require(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("LTMS " + field + " is required");
    }

    @Override
    public String toString() {
        return "LtmsRequestContext[username=" + LtmsRedactor.identifier(username)
                + ", businessId=" + LtmsRedactor.identifier(businessId) + ", rawJwt=[REDACTED]]";
    }
}
