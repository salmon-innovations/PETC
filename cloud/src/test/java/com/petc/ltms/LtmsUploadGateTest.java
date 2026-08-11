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
    void productionUploadAndReplacementAreBlockedBeforeAnyHttpRequestWithoutProductionGate() {
        var transport = new LtmsTransportProperties();
        transport.setMode(LtmsTransportProperties.Mode.PRODUCTION);
        transport.setPetcBaseUrl(URI.create("https://production.ltms.example.test"));
        transport.setJwtBaseUrl(URI.create("https://production.ltms.example.test"));
        transport.setAllowedHosts(Set.of("production.ltms.example.test"));

        var safety = new LtmsSafetyProperties();
        safety.setMode(LtmsMode.PRODUCTION);
        safety.setCommissioningApproved(true);
        safety.setOutboundEnabled(true);
        safety.setUploadEnabled(true);
        safety.setAllowedHosts(java.util.List.of("production.ltms.example.test"));
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
