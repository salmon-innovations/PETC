package com.petc.wallet;

import com.petc.audit.AuditService;
import com.petc.settings.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WalletServiceTest {

    @Mock private JdbcTemplate jdbc;
    @Mock private PlatformSettingsService settings;
    @Mock private AuditService audit;

    @Test
    void chargePerUploadCentavos_usesCenterOverrideWhenPresent() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq("tenant-1")))
                .thenReturn(5_500L);
        WalletService wallet = new WalletService(jdbc, settings, audit);

        assertThat(wallet.chargePerUploadCentavos("tenant-1")).isEqualTo(5_500L);
    }

    @Test
    void chargePerUploadCentavos_fallsBackToPlatformDefault() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq("tenant-1")))
                .thenReturn(null);
        when(settings.chargePerUploadCentavos()).thenReturn(8_000L);
        WalletService wallet = new WalletService(jdbc, settings, audit);

        assertThat(wallet.chargePerUploadCentavos("tenant-1")).isEqualTo(8_000L);
    }

    @Test
    void summaryFor_readsPricingTimestampUsingPlatformSettingsSchema() {
        OffsetDateTime updatedAt = OffsetDateTime.parse("2026-11-19T12:00:00+08:00");
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq("tenant-1")))
                .thenReturn(200_000L, null);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq("tenant-1")))
                .thenReturn(0);
        when(jdbc.queryForObject(anyString(), eq(OffsetDateTime.class)))
                .thenReturn(updatedAt);
        when(settings.chargePerUploadCentavos()).thenReturn(8_000L);
        when(settings.lowBalanceThresholdCentavos()).thenReturn(40_000L);

        WalletService.WalletSummary summary =
                new WalletService(jdbc, settings, audit).summaryFor("tenant-1");

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(sql.capture(), eq(OffsetDateTime.class));
        assertThat(sql.getValue())
                .contains("FROM platform_settings WHERE key IN")
                .contains("wallet.charge_per_upload_centavos")
                .contains("wallet.low_balance_threshold_centavos");
        assertThat(summary.pricingUpdatedAt()).isEqualTo(updatedAt);
    }
}
