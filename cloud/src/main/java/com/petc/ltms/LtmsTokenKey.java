package com.petc.ltms;

/** Cache/lock key. Username is part of the key so tokens cannot cross users. */
public record LtmsTokenKey(String centerId, String environment, String username) {
    public LtmsTokenKey {
        require(centerId, "centerId"); require(environment, "environment"); require(username, "username");
    }
    private static void require(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
    }
    @Override public String toString() { return "LtmsTokenKey[centerId=" + LtmsRedactor.identifier(centerId) + ", environment=" + environment + ", username=" + LtmsRedactor.identifier(username) + "]"; }
}
