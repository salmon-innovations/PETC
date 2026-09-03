package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.audit.AuditService;
import com.petc.wallet.WalletService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubmissionServiceTest {

    @Mock private JdbcTemplate jdbc;
    @Mock private WalletService wallet;
    @Mock private AuditService audit;

    @Test
    void claimPending_locksTransitionsAndSnapshotsEachAttemptBeforeReturningWork() {
        SubmissionService service = new SubmissionService(jdbc, new ObjectMapper(), wallet, audit);

        service.claimPending(7);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<RowMapper<SubmissionService.PendingSubmission>> mapper =
                ArgumentCaptor.forClass(RowMapper.class);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), mapper.capture(), eq(7), eq(300));
        assertThat(sql.getValue())
                .contains("FOR UPDATE SKIP LOCKED")
                .contains("SET state = 'IN_FLIGHT'")
                .contains("INSERT INTO submission_attempts")
                .contains("attempt_sequence = s.attempt_sequence + 1")
                .contains("charge_snapshot_centavos");
    }

    @Test
    void enqueue_snapshotsTheCentersEffectivePrice() {
        SubmissionService service = new SubmissionService(jdbc, new ObjectMapper(), wallet, audit);
        when(wallet.chargePerUploadCentavos("22222222-2222-2222-2222-222222222222"))
                .thenReturn(5_500L);
        when(jdbc.queryForObject(any(String.class), eq(String.class), any(Object[].class)))
                .thenReturn("submission-1");

        service.enqueue(
                "22222222-2222-2222-2222-222222222222",
                "center-1",
                "test-1",
                java.util.Map.of("testId", "test-1"));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(
                sql.capture(), eq(String.class),
                eq("22222222-2222-2222-2222-222222222222"),
                eq("center-1"), eq("test-1"), any(String.class), eq(5_500L),
                eq("PREPAID"), eq(1L));
        assertThat(sql.getValue())
                .contains("charge_snapshot_centavos")
                .contains("price_snapshotted_at")
                .contains("billing_mode_snapshot")
                .contains("billing_profile_revision");
    }

    @Test
    void expiredClaim_movesToReconcilingInsteadOfReturningItToDispatch() {
        SubmissionService service = new SubmissionService(jdbc, new ObjectMapper(), wallet, audit);
        when(jdbc.update(any(String.class))).thenReturn(1);

        int moved = service.moveExpiredClaimsToReconciling();

        assertThat(moved).isEqualTo(1);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, org.mockito.Mockito.times(2)).update(sql.capture());
        assertThat(sql.getAllValues().getFirst())
                .contains("state = 'RECONCILING'")
                .contains("reconciliation_status = 'REQUIRED'")
                .doesNotContain("state = 'PENDING'");
    }

    @Test
    void definitiveRejection_onlyTransitionsAnOwnedInFlightClaim() {
        SubmissionService service = new SubmissionService(jdbc, new ObjectMapper(), wallet, audit);
        when(jdbc.update(any(String.class), any(), any(), any())).thenReturn(0);

        service.markRejected("11111111-1111-1111-1111-111111111111", "bad payload");

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).update(sql.capture(), eq("bad payload"), eq("bad payload"),
                eq("11111111-1111-1111-1111-111111111111"));
        assertThat(sql.getValue())
                .contains("state = 'ACTION_REQUIRED'")
                .contains("state = 'IN_FLIGHT'");
    }

    @Test
    void acceptedSubmission_debitsThePriceSnapshottedAtDispatch() {
        SubmissionService service = new SubmissionService(jdbc, new ObjectMapper(), wallet, audit);
        when(jdbc.queryForObject(any(String.class), eq(Integer.class),
                any(Object[].class))).thenReturn(3);

        service.markAcceptedAndCharge(
                "11111111-1111-1111-1111-111111111111",
                "22222222-2222-2222-2222-222222222222",
                "CEC-1", null, "OR-1", "seal", null, null, 5_500L);

        verify(wallet).chargeForAcceptance(
                "22222222-2222-2222-2222-222222222222",
                "11111111-1111-1111-1111-111111111111",
                3,
                5_500L);
    }
}
