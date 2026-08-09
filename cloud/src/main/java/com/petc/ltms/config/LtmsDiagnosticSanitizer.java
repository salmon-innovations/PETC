package com.petc.ltms.config;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Prevents future LTMS diagnostics from leaking credentials, JWTs, biometrics,
 * owner PII, or complete request bodies.  Transport code should log only the
 * returned map or a support reference, never a payload.
 */
public final class LtmsDiagnosticSanitizer {

    private static final String REDACTED = "[REDACTED]";
    private static final Set<String> SENSITIVE_KEYS = Set.of(
            "authorization", "password", "token", "jwt", "biometric",
            "fingerprint", "owner", "owner_name", "ownername", "request_body", "body"
    );

    private LtmsDiagnosticSanitizer() {
    }

    public static Map<String, String> redactHeaders(Map<String, String> headers) {
        Map<String, String> result = new LinkedHashMap<>();
        if (headers == null) {
            return result;
        }
        headers.forEach((name, value) -> result.put(name,
                isSensitive(name) ? REDACTED : value));
        return result;
    }

    /** Redacts known sensitive diagnostic keys; unknown values remain intact for support correlation. */
    public static Map<String, Object> redactDiagnostic(Map<String, ?> values) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (values == null) {
            return result;
        }
        values.forEach((name, value) -> result.put(name,
                isSensitive(name) ? REDACTED : value));
        return result;
    }

    private static boolean isSensitive(String name) {
        if (name == null) {
            return false;
        }
        String normalized = name.toLowerCase(Locale.ROOT).replace('-', '_');
        return SENSITIVE_KEYS.contains(normalized)
                || normalized.contains("password")
                || normalized.contains("token")
                || normalized.contains("biometric")
                || normalized.contains("fingerprint")
                || normalized.contains("owner");
    }
}
