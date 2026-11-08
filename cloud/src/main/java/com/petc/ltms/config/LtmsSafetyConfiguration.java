package com.petc.ltms.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(LtmsSafetyProperties.class)
class LtmsSafetyConfiguration {
}
