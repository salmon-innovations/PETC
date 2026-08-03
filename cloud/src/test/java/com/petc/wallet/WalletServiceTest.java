package com.petc.wallet;

import com.petc.audit.AuditService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WalletServiceTest {

    private static final String TENANT = "00000000-0000-0000-0000-000000000001";
    private static final String SUBMISSION = "00000000-0000-0000-0000-000000000002";

    @Mock JdbcTemplate jdbc;
    @Mock CenterPricingService pricing;
    @Mock AuditService audit;

    private WalletService wallet;

    @BeforeEach
    void setUp() {
        wallet = new WalletService(jdbc, pricing, audit);
    }

    @Test
    void chargeForAcceptanceUsesSubmissionSnapshotInsteadOfCurrentCenterPrice() {
        when(jdbc.queryForObject(
                contains("SELECT charge_snapshot_centavos"), eq(Long.class),
                eq(SUBMISSION), eq(TENANT))).thenReturn(9_500L);
        when(jdbc.queryForObject(
                contains("SELECT balance_centavos"), eq(Long.class), eq(TENANT)))
                .thenReturn(20_000L);

        wallet.chargeForAcceptance(TENANT, SUBMISSION, 1);

        verify(jdbc).update(
                contains("INSERT INTO wallet_ledger"),
                eq(TENANT), eq(-9_500L), eq(10_500L), eq(SUBMISSION), eq(1),
                eq("LTMS submission accepted"));
        verify(jdbc).update(
                contains("SET balance_centavos = ?"), eq(10_500L), eq(TENANT));
    }
}
