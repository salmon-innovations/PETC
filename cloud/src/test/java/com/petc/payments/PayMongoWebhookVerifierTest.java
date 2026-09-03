package com.petc.payments;

import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;

class PayMongoWebhookVerifierTest {
    @Test
    void verifiesStructuredTestSignatureAgainstRawBody() throws Exception {
        PayMongoProperties properties = new PayMongoProperties();
        properties.setEnabled(true);
        properties.setLiveMode(false);
        properties.setWebhookSecret("whsec-unit-test");
        byte[] body = "{\"data\":{\"id\":\"evt_1\"}}".getBytes(StandardCharsets.UTF_8);
        long timestamp = Instant.now().getEpochSecond();
        byte[] signed = (timestamp + "." + new String(body, StandardCharsets.UTF_8))
                .getBytes(StandardCharsets.UTF_8);
        String signature = hmac(properties.getWebhookSecret(), signed);

        assertThat(new PayMongoWebhookVerifier(properties)
                .verify(body, "t=" + timestamp + ",te=" + signature + ",li=")).isTrue();
    }

    @Test
    void rejectsWrongAndStaleSignatures() throws Exception {
        PayMongoProperties properties = new PayMongoProperties();
        properties.setEnabled(true);
        properties.setWebhookSecret("whsec-unit-test");
        byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
        long stale = Instant.now().minusSeconds(600).getEpochSecond();

        assertThat(new PayMongoWebhookVerifier(properties)
                .verify(body, "t=" + stale + ",te=" + hmac(properties.getWebhookSecret(),
                        (stale + ".{}").getBytes(StandardCharsets.UTF_8)) + ",li=")).isFalse();
        assertThat(new PayMongoWebhookVerifier(properties)
                .verify(body, "t=" + Instant.now().getEpochSecond() + ",te=00,li=")).isFalse();
    }

    private static String hmac(String secret, byte[] body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(body));
    }
}
