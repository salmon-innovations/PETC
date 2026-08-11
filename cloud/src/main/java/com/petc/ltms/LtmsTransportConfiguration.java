package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.config.LtmsSafetyGuard;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Creates a no-network client unless a deployment explicitly enables LTMS. */
@Configuration
@EnableConfigurationProperties(LtmsTransportProperties.class)
public class LtmsTransportConfiguration {
    @Bean
    LtmsV2Client ltmsV2Client(LtmsTransportProperties properties, LtmsSafetyGuard safetyGuard, ObjectMapper mapper) {
        if (!properties.getMode().permitsOutboundCalls() || !safetyGuard.outboundCallsPermitted()) return new DisabledLtmsV2Client();
        return new HttpLtmsV2Client(properties, safetyGuard, mapper);
    }

    @Bean
    LtmsJwtClient ltmsJwtClient(LtmsTransportProperties properties, LtmsSafetyGuard safetyGuard, ObjectMapper mapper) {
        if (!properties.getMode().permitsOutboundCalls() || !safetyGuard.outboundCallsPermitted()) return new DisabledLtmsJwtClient();
        return new HttpLtmsJwtClient(properties, safetyGuard, mapper);
    }
}
