package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/** Parses the unverified payload of a compact JWT only to schedule cache refresh. */
public final class LtmsJwtParser {
    private final ObjectMapper mapper;

    public LtmsJwtParser(ObjectMapper mapper) { this.mapper = mapper; }

    public ParsedLtmsJwt parseForScheduling(String rawToken) {
        try {
            String[] pieces = rawToken == null ? new String[0] : rawToken.split("\\.", -1);
            if (pieces.length != 3 || pieces[0].isBlank() || pieces[1].isBlank() || pieces[2].isBlank()) {
                throw new IllegalArgumentException("not a compact JWT");
            }
            JsonNode payload = mapper.readTree(new String(Base64.getUrlDecoder().decode(pieces[1]), StandardCharsets.UTF_8));
            return new ParsedLtmsJwt(rawToken, numericInstant(payload, "iat"), numericInstant(payload, "exp"));
        } catch (Exception e) {
            throw new IllegalArgumentException("LTMS authentication response did not contain a schedulable JWT", e);
        }
    }

    private static Instant numericInstant(JsonNode payload, String name) {
        JsonNode value = payload.path(name);
        if (!value.canConvertToLong()) throw new IllegalArgumentException("JWT " + name + " is missing or invalid");
        return Instant.ofEpochSecond(value.longValue());
    }
}
