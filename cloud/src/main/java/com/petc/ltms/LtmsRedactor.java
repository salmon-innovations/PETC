package com.petc.ltms;

import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Logging helpers. Full LTMS request/response bodies must not be logged. */
public final class LtmsRedactor {
    private static final Pattern COMPACT_JWT = Pattern.compile("(?<![A-Za-z0-9_-])[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+(?![A-Za-z0-9_-])");
    private static final Set<String> SENSITIVE_HEADERS = Set.of("authorization", "cookie", "set-cookie", "x-api-key");

    private LtmsRedactor() { }

    public static String redact(String value) {
        if (value == null) return null;
        return COMPACT_JWT.matcher(value).replaceAll("[REDACTED_JWT]");
    }

    public static String identifier(String value) {
        if (value == null || value.isBlank()) return "[REDACTED]";
        return value.length() <= 4 ? "[REDACTED]" : value.substring(0, 2) + "…" + value.substring(value.length() - 2);
    }

    public static Map<String, String> redactHeaders(Map<String, String> headers) {
        return headers.entrySet().stream().collect(Collectors.toUnmodifiableMap(
                Map.Entry::getKey,
                entry -> SENSITIVE_HEADERS.contains(entry.getKey().toLowerCase()) ? "[REDACTED]" : redact(entry.getValue())
        ));
    }
}
