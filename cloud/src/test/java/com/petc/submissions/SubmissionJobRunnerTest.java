package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.gov.EmissionPayload;
import com.petc.gov.GovRegistryClient;
import com.petc.gov.MockGovRegistryClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SubmissionJobRunnerTest {

    @Mock
    private SubmissionService service;

    private GovRegistryClient govClient;
    private SubmissionJobRunner runner;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        govClient = new MockGovRegistryClient();
        runner = new SubmissionJobRunner(service, govClient, mapper, 5);
    }

    @Test
    void processPending_acceptedPlate_callsMarkAccepted() throws Exception {
        String payloadJson = mapper.writeValueAsString(Map.of(
                "plateNumber", "ABC1234",
                "fuelType", "GAS",
                "passFail", true,
                "readings", Map.of(),
                "photos", List.of(),
                "operatorId", "op-1"
        ));
        var pending = new SubmissionService.PendingSubmission(
                "sub-1", "tenant-1", "center-1", "test-1", payloadJson, 0);
        when(service.claimPending(anyInt())).thenReturn(List.of(pending));

        runner.processPending();

        verify(service).markInFlight("sub-1");
        ArgumentCaptor<String> certCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> orCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> dermalogCaptor = ArgumentCaptor.forClass(String.class);
        verify(service).markAccepted(
                eq("sub-1"),
                certCaptor.capture(),
                isNull(),
                orCaptor.capture(),
                dermalogCaptor.capture(),
                any(LocalDate.class),
                any(LocalDate.class)
        );
        assertThat(certCaptor.getValue()).startsWith("CERT-");
        assertThat(orCaptor.getValue()).isNotBlank();
        assertThat(dermalogCaptor.getValue()).isNotBlank();
        verify(service, never()).markRejected(any(), any());
    }

    @Test
    void processPending_failPlate_callsMarkRejected() throws Exception {
        String payloadJson = mapper.writeValueAsString(Map.of(
                "plateNumber", "FAIL1234",
                "fuelType", "GAS",
                "passFail", false,
                "readings", Map.of(),
                "photos", List.of(),
                "operatorId", "op-1"
        ));
        var pending = new SubmissionService.PendingSubmission(
                "sub-2", "tenant-1", "center-1", "test-2", payloadJson, 0);
        when(service.claimPending(anyInt())).thenReturn(List.of(pending));

        runner.processPending();

        verify(service).markInFlight("sub-2");
        verify(service).markRejected(eq("sub-2"), anyString());
        verify(service, never()).markAccepted(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void processPending_govThrows_callsMarkRetry() throws Exception {
        GovRegistryClient failingGov = mock(GovRegistryClient.class);
        when(failingGov.submitEmissionResult(any(EmissionPayload.class)))
                .thenThrow(new RuntimeException("timeout"));
        runner = new SubmissionJobRunner(service, failingGov, mapper, 5);

        String payloadJson = mapper.writeValueAsString(Map.of(
                "plateNumber", "ABC1234", "fuelType", "GAS",
                "passFail", true, "readings", Map.of(), "photos", List.of()));
        var pending = new SubmissionService.PendingSubmission(
                "sub-3", "tenant-1", "center-1", "test-3", payloadJson, 1);
        when(service.claimPending(anyInt())).thenReturn(List.of(pending));

        runner.processPending();

        verify(service).markRetry(eq("sub-3"), eq(1), eq(5), any(int[].class));
        verify(service, never()).markAccepted(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void processPending_emptyBatch_doesNothing() {
        when(service.claimPending(anyInt())).thenReturn(List.of());
        runner.processPending();
        verify(service, never()).markInFlight(any());
    }
}
