package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.config.LtmsMode;
import com.petc.ltms.config.LtmsSafetyGuard;
import com.petc.ltms.config.LtmsSafetyProperties;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class LtmsUploadGateTest {

    @Test
    void uploadAndReplacementAreBlockedBeforeAnyHttpRequestWhenMutationGateIsFalse() {
        var transport = new LtmsTransportProperties();
        transport.setMode(LtmsTransportProperties.Mode.QA_ENABLED);
        transport.setPetcBaseUrl(URI.create("https://qa.ltms.example.test"));
        transport.setJwtBaseUrl(URI.create("https://qa.ltms.example.test"));
        transport.setAllowedHosts(Set.of("qa.ltms.example.test"));

        var safety = new LtmsSafetyProperties();
        safety.setMode(LtmsMode.QA_ENABLED);
        safety.setOutboundEnabled(true);
        safety.setUploadEnabled(false);
        safety.setAllowedHosts(java.util.List.of("qa.ltms.example.test"));
        var guard = new LtmsSafetyGuard(safety);
        guard.afterPropertiesSet();

        var client = new HttpLtmsV2Client(transport, guard, new ObjectMapper());
        var context = new LtmsRequestContext("center-user", "business-id", "jwt");
        var body = new ObjectMapper().createObjectNode();

        assertThatIllegalStateException()
                .isThrownBy(() -> client.upload(context, new LtmsDtos.CecUploadRequest(body)))
                .withMessageContaining("disabled");
        assertThatIllegalStateException()
                .isThrownBy(() -> client.replace(context, new LtmsDtos.CecReplaceRequest(body)))
                .withMessageContaining("disabled");
    }
}
