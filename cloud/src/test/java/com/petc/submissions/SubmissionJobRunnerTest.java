package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.gov.EmissionPayload;
import com.petc.gov.GovRegistryClient;
import com.petc.gov.MockGovRegistryClient;
import com.petc.settings.PlatformSettingsService;
import com.petc.wallet.WalletService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SubmissionJobRunnerTest {

    private static final long CHARGE = 8000L;      // PHP 80.00
    private static final long FUNDED = 100_000L;   // PHP 1,000.00

    @Mock
    private SubmissionService service;
    @Mock
    private PlatformSettingsService settings;
    @Mock
    private WalletService wallet;

    private GovRegistryClient govClient;
    private SubmissionJobRunner runner;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        govClient = new MockGovRegistryClient();
        when(settings.chargePerUploadCentavos()).thenReturn(CHARGE);
        when(settings.maxAttempts()).thenReturn(5);
        when(settings.backoffSeconds()).thenReturn(new int[]{5, 15, 60, 300, 900});
        when(wallet.getBalance(anyString())).thenReturn(FUNDED);
        runner = new SubmissionJobRunner(service, govClient, mapper, settings, wallet);
    }

    private SubmissionService.PendingSubmission pending(
            String id, String testId, String plate, int attempts, boolean graceReleased
    ) throws Exception {
        String payloadJson = mapper.writeValueAsString(Map.of(
                "plateNumber", plate,
                "fuelType", "GAS",
                "passFail", true,
                "readings", Map.of(),
                "photos", List.of(),
                "operatorId", "op-1"
        ));
        return new SubmissionService.PendingSubmission(
                id, "tenant-1", "center-1", testId, payloadJson, attempts, graceReleased);
    }

    @Test
    void processPending_acceptedPlate_chargesAndMarksAccepted() throws Exception {
        when(service.claimPending(anyInt()))
                .thenReturn(List.of(pending("sub-1", "test-1", "ABC1234", 0, false)));

        runner.processPending();

        verify(service).markInFlight("sub-1");
        ArgumentCaptor<String> certCaptor = ArgumentCaptor.forClass(String.class);
        verify(service).markAcceptedAndCharge(
                eq("sub-1"), eq("tenant-1"),
                certCaptor.capture(), isNull(), anyString(), anyString(),
                any(LocalDate.class), any(LocalDate.class));
        assertThat(certCaptor.getValue()).startsWith("CERT-");
        verify(service, never()).markRejected(any(), any());
        verify(service, never()).markBlocked(any(), any(), anyLong());
    }

    @Test
    void processPending_failPlate_callsMarkRejected() throws Exception {
        when(service.claimPending(anyInt()))
                .thenReturn(List.of(pending("sub-2", "test-2", "FAIL1234", 0, false)));

        runner.processPending();

        verify(service).markInFlight("sub-2");
        verify(service).markRejected(eq("sub-2"), anyString());
        verify(service, never()).markAcceptedAndCharge(
                any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void processPending_govThrows_retriesWithSettingsBackoff() throws Exception {
        GovRegistryClient failingGov = mock(GovRegistryClient.class);
        when(failingGov.submitEmissionResult(any(EmissionPayload.class)))
                .thenThrow(new RuntimeException("timeout"));
        runner = new SubmissionJobRunner(service, failingGov, mapper, settings, wallet);
        when(service.claimPending(anyInt()))
                .thenReturn(List.of(pending("sub-3", "test-3", "ABC1234", 1, false)));

        runner.processPending();

        verify(service).markRetry(eq("sub-3"), eq(1), eq(5), any(int[].class));
        verify(service, never()).markAcceptedAndCharge(
                any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void processPending_emptyBatch_doesNothing() {
        when(service.claimPending(anyInt())).thenReturn(List.of());
        runner.processPending();
        verify(service, never()).markInFlight(any());
    }

    // ---------------------------------------------------------------- wallet

    @Test
    void processPending_zeroBalance_blocksInsteadOfDispatching() throws Exception {
        when(wallet.getBalance("tenant-1")).thenReturn(0L);
        when(service.claimPending(anyInt()))
                .thenReturn(List.of(pending("sub-4", "test-4", "ABC1234", 0, false)));

        runner.processPending();

        verify(service).markBlocked("sub-4", "tenant-1", 0L);
        // The submission must never reach LTMS when it cannot be paid for.
        verify(service, never()).markInFlight(any());
        verify(service, never()).markAcceptedAndCharge(
                any(), any(), any(), any(), any(), any(), any(), any());
    }

    /**
     * The batch-level running total is what stops a center with funds for three
     * uploads from filing ten: a per-row check against the stored balance would
     * see the same untouched balance every time.
     */
    @Test
    void processPending_partialFunds_dispatchesOnlyWhatIsAffordable() throws Exception {
        when(wallet.getBalance("tenant-1")).thenReturn(CHARGE * 3);
        when(service.claimPending(anyInt())).thenReturn(List.of(
                pending("s1", "t1", "ABC1234", 0, false),
                pending("s2", "t2", "ABC1234", 0, false),
                pending("s3", "t3", "ABC1234", 0, false),
                pending("s4", "t4", "ABC1234", 0, false),
                pending("s5", "t5", "ABC1234", 0, false)
        ));

        runner.processPending();

        verify(service, times(3)).markInFlight(any());
        verify(service, times(2)).markBlocked(any(), eq("tenant-1"), anyLong());
    }

    /**
     * Grace-released rows bypass the wallet entirely — this is the only path
     * that lets a balance go negative, and it exists so a billing shortfall
     * cannot become a DO 2023-008 compliance breach.
     */
    @Test
    void processPending_graceReleased_dispatchesDespiteZeroBalance() throws Exception {
        when(wallet.getBalance("tenant-1")).thenReturn(0L);
        when(service.claimPending(anyInt()))
                .thenReturn(List.of(pending("sub-5", "test-5", "ABC1234", 0, true)));

        runner.processPending();

        verify(service).markInFlight("sub-5");
        verify(service).markAcceptedAndCharge(
                eq("sub-5"), eq("tenant-1"), anyString(), isNull(), anyString(), anyString(),
                any(LocalDate.class), any(LocalDate.class));
        verify(service, never()).markBlocked(any(), any(), anyLong());
    }
}
