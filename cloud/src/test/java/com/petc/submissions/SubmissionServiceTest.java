package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.audit.AuditService;
import com.petc.wallet.CenterPricingService;
import com.petc.wallet.WalletService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubmissionServiceTest {

    @Mock JdbcTemplate jdbc;
    @Mock CenterPricingService pricing;
    @Mock WalletService wallet;
    @Mock AuditService audit;

    @Test
    void enqueueSnapshotsCurrentCenterPriceInCentavos() {
        String tenant = "00000000-0000-0000-0000-000000000001";
        when(pricing.getFor(tenant)).thenReturn(new CenterPricingService.PricingConfig(
                9_500L, 50_000L, OffsetDateTime.now(), "admin@petc.test"));
        when(jdbc.queryForObject(
                contains("INSERT INTO submissions"), eq(String.class),
                eq(tenant), eq("center-1"), eq("test-1"), eq("{\"passFail\":true}"), eq(9_500L)))
                .thenReturn("submission-1");
        var service = new SubmissionService(
                jdbc, new ObjectMapper(), pricing, wallet, audit);

        String id = service.enqueue(
                tenant, "center-1", "test-1", Map.of("passFail", true));

        assertThat(id).isEqualTo("submission-1");
        verify(jdbc).queryForObject(
                contains("charge_snapshot_centavos = CASE"), eq(String.class),
                eq(tenant), eq("center-1"), eq("test-1"), eq("{\"passFail\":true}"), eq(9_500L));
    }
}
