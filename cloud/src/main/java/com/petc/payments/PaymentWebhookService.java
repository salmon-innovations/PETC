package com.petc.payments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;

@Service
public class PaymentWebhookService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public PaymentWebhookService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void receive(byte[] rawBody, boolean expectedLiveMode) {
        try {
            JsonNode root = mapper.readTree(rawBody);
            JsonNode envelope = root.path("data");
            String eventId = text(envelope.get("id"));
            JsonNode attributes = envelope.path("attributes");
            String eventType = text(attributes.get("type"));
            boolean liveMode = attributes.path("livemode").asBoolean(false);
            if (eventId == null || eventType == null) throw new IllegalArgumentException("Malformed event");
            if (liveMode != expectedLiveMode) throw new IllegalArgumentException("Webhook mode mismatch");
            String payload = new String(rawBody, StandardCharsets.UTF_8);
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(rawBody));
            jdbc.update("""
                    INSERT INTO payment_webhook_events
                        (provider_event_id, event_type, livemode, payload_hash, raw_payload)
                    VALUES (?, ?, ?, ?, ?::jsonb)
                    ON CONFLICT (provider_event_id) DO NOTHING
                    """, eventId, eventType, liveMode, hash, payload);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("Malformed PayMongo webhook");
        }
    }

    @Transactional
    public List<ClaimedEvent> claim(int limit) {
        jdbc.update("""
                UPDATE payment_webhook_events
                   SET processing_status = 'RECEIVED', claimed_at = NULL,
                       last_error = 'Recovered abandoned webhook claim'
                 WHERE processing_status = 'PROCESSING'
                   AND claimed_at < now() - interval '5 minutes'
                """);
        return jdbc.query("""
                WITH due AS (
                    SELECT provider_event_id FROM payment_webhook_events
                     WHERE processing_status = 'RECEIVED'
                     ORDER BY received_at
                     FOR UPDATE SKIP LOCKED LIMIT ?
                )
                UPDATE payment_webhook_events e
                   SET processing_status = 'PROCESSING', claimed_at = now()
                  FROM due WHERE e.provider_event_id = due.provider_event_id
                RETURNING e.provider_event_id, e.event_type, e.livemode, e.raw_payload::text
                """, (rs, rowNum) -> new ClaimedEvent(rs.getString("provider_event_id"),
                        rs.getString("event_type"), rs.getBoolean("livemode"),
                        rs.getString("raw_payload")), limit);
    }

    public void complete(String eventId, String status, String error) {
        jdbc.update("""
                UPDATE payment_webhook_events
                   SET processing_status = ?, processed_at = now(), last_error = ?
                 WHERE provider_event_id = ?
                """, status, error, eventId);
    }

    public String paymentIntentId(ClaimedEvent event) {
        try {
            JsonNode resource = mapper.readTree(event.rawPayload()).at("/data/attributes/data");
            if (event.eventType().startsWith("payment_intent.")) return text(resource.get("id"));
            if (event.eventType().startsWith("payment.")) {
                JsonNode attrs = resource.has("attributes") ? resource.path("attributes") : resource;
                return text(attrs.get("payment_intent_id"));
            }
            return null;
        } catch (Exception e) {
            throw new IllegalArgumentException("Malformed stored PayMongo event");
        }
    }

    private static String text(JsonNode node) {
        return node == null || node.isMissingNode() || node.isNull() ? null : node.asText();
    }

    public record ClaimedEvent(String eventId, String eventType, boolean liveMode, String rawPayload) {}
}
