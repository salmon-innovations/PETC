package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.regions.Region;

import java.time.Clock;
import java.time.Duration;

/** Cloud wiring for shared LTMS secrets and JWT lifecycle state. */
@Configuration
public class LtmsTokenConfiguration {
    @Bean
    SecretsManagerClient ltmsSecretsManagerClient(
            @Value("${petc.s3.region:ap-southeast-1}") String awsRegion
    ) {
        return SecretsManagerClient.builder().region(Region.of(awsRegion)).build();
    }

    @Bean
    LtmsCredentialsResolver ltmsCredentialsResolver(SecretsManagerClient ltmsSecretsManagerClient, ObjectMapper mapper) {
        return new AwsSecretsManagerLtmsCredentialsResolver(ltmsSecretsManagerClient, mapper);
    }

    @Bean
    LtmsTokenCache ltmsTokenCache(JdbcTemplate jdbc, @Value("${petc.jwt.secret}") String jwtSecret) {
        return new JdbcLtmsTokenCache(jdbc, jwtSecret);
    }

    @Bean
    LtmsTokenLock ltmsTokenLock(JdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
        return new JdbcLtmsTokenLock(jdbc, transactionManager);
    }

    @Bean
    LtmsCenterAccessState ltmsCenterAccessState(JdbcTemplate jdbc) {
        return new JdbcLtmsCenterAccessState(jdbc);
    }

    @Bean
    LtmsJwtParser ltmsJwtParser(ObjectMapper mapper) {
        return new LtmsJwtParser(mapper);
    }

    @Bean
    LtmsTokenManager ltmsTokenManager(
            LtmsTokenCache cache,
            LtmsTokenLock lock,
            LtmsCenterAccessState accessState,
            LtmsJwtClient jwtClient,
            LtmsJwtParser parser
    ) {
        return new LtmsTokenManager(cache, lock, accessState, jwtClient, parser, Clock.systemUTC(), Duration.ZERO);
    }
}
