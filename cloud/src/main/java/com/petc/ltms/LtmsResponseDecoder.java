package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.LtmsDtos.Error;
import com.petc.ltms.LtmsDtos.Response;

import java.util.List;
import java.util.Map;

/** Decodes documented success/error envelopes without assuming status determines outcome. */
public final class LtmsResponseDecoder {
    private LtmsResponseDecoder() { }

    public static Response decode(ObjectMapper mapper, LtmsOperation operation, int status, Map<String, List<String>> headers, String payload) {
        try {
            JsonNode body = payload == null || payload.isBlank() ? mapper.createObjectNode() : mapper.readTree(payload);
            String inboxId = text(body, "inbox_id", "inboxId");
            if (inboxId == null) inboxId = header(headers, "inbox_id", "x-inbox-id");
            Integer code = integer(body, "error_code", "errorCode");
            if (code == null) code = integerHeader(headers, "error_code", "x-error-code");
            String message = text(body, "error_msg", "error_message", "message");
            List<LtmsDtos.Reason> reasons = reasons(body.path("reasons"));
            Error error = code == null && message == null ? null : new Error(code, message, reasons);
            return new Response(operation, status, inboxId, error, body);
        } catch (Exception e) {
            throw new LtmsRemoteException("LTMS returned an unreadable response", null, header(headers, "inbox_id", "x-inbox-id"));
        }
    }

    private static String text(JsonNode body, String... names) {
        for (String name : names) {
            JsonNode node = body.path(name);
            if (!node.isMissingNode() && !node.isNull() && !node.asText().isBlank()) return node.asText();
        }
        return null;
    }
    private static Integer integer(JsonNode body, String... names) {
        for (String name : names) {
            JsonNode node = body.path(name);
            if (node.canConvertToInt()) return node.intValue();
            if (node.isTextual()) try { return Integer.valueOf(node.textValue()); } catch (NumberFormatException ignored) { }
        }
        return null;
    }
    private static List<LtmsDtos.Reason> reasons(JsonNode node) {
        if (!node.isArray()) return List.of();
        return java.util.stream.StreamSupport.stream(node.spliterator(), false)
                .map(value -> value.isObject()
                        ? new LtmsDtos.Reason(text(value, "code", "error_code"), text(value, "message", "error_msg"))
                        : new LtmsDtos.Reason(null, value.asText()))
                .toList();
    }
    private static String header(Map<String, List<String>> headers, String... names) {
        for (var entry : headers.entrySet()) {
            for (String name : names) if (entry.getKey().equalsIgnoreCase(name) && !entry.getValue().isEmpty()) return entry.getValue().getFirst();
        }
        return null;
    }
    private static Integer integerHeader(Map<String, List<String>> headers, String... names) {
        String value = header(headers, names);
        try { return value == null ? null : Integer.valueOf(value); } catch (NumberFormatException ignored) { return null; }
    }
}
