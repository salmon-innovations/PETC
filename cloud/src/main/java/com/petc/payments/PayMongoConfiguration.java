package com.petc.payments;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(PayMongoProperties.class)
public class PayMongoConfiguration {
    @Bean
    QrPaymentGateway qrPaymentGateway(PayMongoProperties properties, ObjectMapper mapper) {
        properties.validateEnabled();
        return properties.isEnabled()
                ? new PayMongoQrPaymentGateway(properties, mapper)
                : new DisabledQrPaymentGateway();
    }
}
