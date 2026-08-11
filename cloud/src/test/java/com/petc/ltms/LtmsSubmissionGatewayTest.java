package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.config.LtmsCenterConfigRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LtmsSubmissionGatewayTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private LtmsCenterConfigRepository configs;
    private LtmsTokenManager tokens;
    private LtmsCecNumberAllocator cecNumbers;
    private LtmsV2Client client;
    private LtmsSubmissionGateway gateway;

    @BeforeEach
    void setUp() {
        configs = mock(LtmsCenterConfigRepository.class);
        tokens = mock(LtmsTokenManager.class);
        cecNumbers = mock(LtmsCecNumberAllocator.class);
        client = mock(LtmsV2Client.class);
        gateway = new LtmsSubmissionGateway(configs, resolver(), tokens, cecNumbers, client, mapper);

        var config = new LtmsCenterConfigRepository.LtmsCenterConfig(
                "tenant-1", "center-1", "ltms-user", "PE-24-12345", "3012",
                "secret-ref", LtmsCenterConfigRepository.LtmsEnvironment.PRODUCTION, true,
                LtmsCenterConfigRepository.CredentialVerificationState.VERIFIED,
                OffsetDateTime.now(), OffsetDateTime.now());
        when(configs.findEnabledFor("tenant-1", "center-1")).thenReturn(Optional.of(config));
        when(cecNumbers.allocateForSubmission("submission-1", "tenant-1", "3012"))
                .thenReturn(new LtmsCecNumberAllocator.Allocation("2026030120000042", "000042"));
        when(tokens.getOrAcquire(any())).thenReturn(token("first-token"));
        when(tokens.refreshOnce(any())).thenReturn(token("refreshed-token"));
    }

    @Test
    void mapsManualFieldsAndReturnsAcceptedLtmsResult() throws Exception {
        var body = mapper.readTree("""
                {"inbox_id":"INBOX-1","cec_number":"2026030120000042",
                 "evaluation":"PASSED","expiry_date":"2026-10-10T12:30:00"}
                """);
        when(client.upload(any(), any())).thenReturn(new LtmsDtos.Response(
                LtmsOperation.UPLOAD, 200, "INBOX-1", null, body));

        var result = gateway.upload("submission-1", "tenant-1", "center-1", canonicalPayload());

        assertThat(result.accepted()).isTrue();
        assertThat(result.cecNumber()).isEqualTo("2026030120000042");
        assertThat(result.orNumber()).isEqualTo("000042");
        assertThat(result.expiry()).isEqualTo(Instant.parse("2026-10-10T04:30:00Z"));

        var request = ArgumentCaptor.forClass(LtmsDtos.CecUploadRequest.class);
        verify(client).upload(any(), request.capture());
        assertThat(request.getValue().payload().at("/vehicle/mv_file_number").asText()).isEqualTo("020400002073574");
        assertThat(request.getValue().payload().at("/vehicle/classification").asText()).isEqualTo("PRIVATE");
        assertThat(request.getValue().payload().at("/inspection/nox").isNull()).isTrue();
    }

    @Test
    void error311RefreshesAndRetriesTheSameCecExactlyOnce() throws Exception {
        var expired = new LtmsDtos.Response(LtmsOperation.UPLOAD, 401, "INBOX-OLD",
                new LtmsDtos.Error(311, "Token expired", List.of()), mapper.createObjectNode());
        var successBody = mapper.readTree("""
                {"inbox_id":"INBOX-NEW","cec_number":"2026030120000042","evaluation":"PASSED"}
                """);
        var success = new LtmsDtos.Response(LtmsOperation.UPLOAD, 200, "INBOX-NEW", null, successBody);
        when(client.upload(any(), any())).thenReturn(expired, success);

        var result = gateway.upload("submission-1", "tenant-1", "center-1", canonicalPayload());

        assertThat(result.accepted()).isTrue();
        verify(tokens).refreshOnce(any());
        verify(client, times(2)).upload(any(), any());
        verify(cecNumbers).allocateForSubmission("submission-1", "tenant-1", "3012");
    }

    private LtmsCredentialsResolver resolver() {
        return new LtmsCredentialsResolver() {
            @Override
            public <T> T withCredentials(
                    LtmsCenterConfigRepository.LtmsCenterConfig center,
                    Function<LtmsCredentials, T> action
            ) {
                var credentials = new LtmsCredentials(
                        new LtmsTokenKey(center.centerId(), center.environment().name(), center.ltmsUsername()),
                        "password".toCharArray());
                try {
                    return action.apply(credentials);
                } finally {
                    credentials.clearPassword();
                }
            }
        };
    }

    private ParsedLtmsJwt token(String raw) {
        return new ParsedLtmsJwt(raw, Instant.parse("2026-08-11T00:00:00Z"),
                Instant.parse("2026-08-12T00:00:00Z"));
    }

    private String canonicalPayload() {
        return """
                {
                  "testDatetime":"2026-08-11T03:00:00Z",
                  "inspection":{"purpose":"FOR_RENEWAL"},
                  "vehicle":{"plateNo":"ABC123","mvNo":"020400002073574",
                    "engineNo":"ENGINE-1","chassisNo":"CHASSIS-1","fuelType":"GAS",
                    "dotrVehicleGroup":"LIGHT","classification":"PRIVATE"},
                  "owner":{"ownerType":"INDIVIDUAL","lastName":"DELA CRUZ",
                    "firstName":"JUAN","address":"123 STREET","city":"MANILA"},
                  "technician":{"technicianName":"TECHNICIAN ONE"},
                  "readings":{"co_pct":0.1,"hc_ppm":10,"co2_pct":12.0,
                    "o2_pct":1.2,"lambda_value":1.0,"rpm":900}
                }
                """;
    }
}
