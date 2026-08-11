package com.petc.ltms;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class LtmsTransportPropertiesTest {

    @Test
    void preservesTheDocumentedOrdsBasePath() {
        var properties = new LtmsTransportProperties();
        properties.setMode(LtmsTransportProperties.Mode.PRODUCTION);
        properties.setPetcBaseUrl(URI.create("https://petc.example.test/ords/dl_interfaces"));
        properties.setJwtBaseUrl(URI.create("https://jwt.example.test"));
        properties.setAllowedHosts(Set.of("petc.example.test", "jwt.example.test"));

        assertThat(properties.petcEndpoint("/v2/cec/upload"))
                .isEqualTo(URI.create("https://petc.example.test/ords/dl_interfaces/v2/cec/upload"));
        assertThat(properties.jwtEndpoint("/ords/dl_user_management/authentication/latest/authenticate"))
                .isEqualTo(URI.create("https://jwt.example.test/ords/dl_user_management/authentication/latest/authenticate"));
    }
}
