package com.petc.payments;

import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;

@Component
public class PayMongoWebhookVerifier {
    private final PayMongoProperties properties;

    public PayMongoWebhookVerifier(PayMongoProperties properties) { this.properties = properties; }

    public boolean verify(byte[] rawBody, String header) {
        if (!properties.isEnabled() || header == null || header.isBlank()) return false;
        try {
            Map<String, String> parts = parse(header);
            if (parts.containsKey("t")) {
                long timestamp = Long.parseLong(parts.get("t"));
                if (Math.abs(Instant.now().getEpochSecond() - timestamp)
                        > properties.getWebhookTolerance().toSeconds()) return false;
                String supplied = parts.get(properties.isLiveMode() ? "li" : "te");
                if (supplied == null || supplied.isBlank()) return false;
                byte[] prefix = (timestamp + ".").getBytes(StandardCharsets.UTF_8);
                byte[] signed = new byte[prefix.length + rawBody.length];
                System.arraycopy(prefix, 0, signed, 0, prefix.length);
                System.arraycopy(rawBody, 0, signed, prefix.length, rawBody.length);
                return constantTimeHexEquals(hmac(signed), supplied);
            }
            // Some PayMongo documentation/examples expose a single raw HMAC.
            return constantTimeHexEquals(hmac(rawBody), header.trim());
        } catch (Exception ignored) {
            return false;
        }
    }

    private byte[] hmac(byte[] data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(properties.getWebhookSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static boolean constantTimeHexEquals(byte[] expected, String supplied) {
        byte[] actual;
        try {
            actual = HexFormat.of().parseHex(supplied);
        } catch (IllegalArgumentException invalidHex) {
            return false;
        }
        return MessageDigest.isEqual(expected, actual);
    }

    private static Map<String, String> parse(String header) {
        Map<String, String> values = new HashMap<>();
        for (String part : header.split(",")) {
            int separator = part.indexOf('=');
            if (separator > 0) values.put(part.substring(0, separator).trim(), part.substring(separator + 1).trim());
        }
        return values;
    }
}
