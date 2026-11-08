package com.petc.wallet;

import com.petc.audit.AuditService;
import com.petc.settings.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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
}
