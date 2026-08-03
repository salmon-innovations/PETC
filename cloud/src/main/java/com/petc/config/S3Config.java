package com.petc.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;

@Configuration
public class S3Config {

    @Value("${petc.s3.endpoint}")
    private String endpoint;

    @Value("${petc.s3.region}")
    private String region;

    @Value("${petc.s3.access-key}")
    private String accessKey;

    @Value("${petc.s3.secret-key}")
    private String secretKey;

    @Bean
    public S3Client s3Client() {
        var builder = S3Client.builder()
                .region(Region.of(region))
                .credentialsProvider(credentialsProvider());

        if (hasCustomEndpoint()) {
            builder.endpointOverride(URI.create(endpoint.trim()))
                    .forcePathStyle(true);
        }
        return builder.build();
    }

    @Bean
    public S3Presigner s3Presigner() {
        var builder = S3Presigner.builder()
                .region(Region.of(region))
                .credentialsProvider(credentialsProvider());

        if (hasCustomEndpoint()) {
            builder.endpointOverride(URI.create(endpoint.trim()))
                    .serviceConfiguration(S3Configuration.builder()
                            .pathStyleAccessEnabled(true)
                            .build());
        }
        return builder.build();
    }

    private AwsCredentialsProvider credentialsProvider() {
        boolean hasAccessKey = accessKey != null && !accessKey.isBlank();
        boolean hasSecretKey = secretKey != null && !secretKey.isBlank();
        if (hasAccessKey != hasSecretKey) {
            throw new IllegalStateException(
                    "S3_ACCESS_KEY and S3_SECRET_KEY must either both be set or both be empty");
        }
        if (hasAccessKey) {
            return StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(accessKey.trim(), secretKey.trim()));
        }
        // AWS_PROFILE selects a named local profile. In deployed environments
        // the same chain naturally uses task, instance, or web-identity roles.
        return DefaultCredentialsProvider.create();
    }

    private boolean hasCustomEndpoint() {
        return endpoint != null && !endpoint.isBlank();
    }
}
