package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.audit.AuditService;
import com.petc.wallet.CenterPricingService;
import com.petc.wallet.WalletService;
import com.petc.lanes.LaneQuotaService;
import com.petc.lanes.LateSubmissionException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;
import java.time.LocalDate;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubmissionServiceTest {

    @Mock JdbcTemplate jdbc;
    @Mock CenterPricingService pricing;
    @Mock WalletService wallet;
    @Mock AuditService audit;
    @Mock LaneQuotaService quota;

    @Test
    void enqueueSnapshotsCurrentCenterPriceInCentavos() {
        String tenant = "00000000-0000-0000-0000-000000000001";
        String testDatetime = LocalDate.now(LaneQuotaService.BUSINESS_ZONE) + "T10:00:00+08:00";
        var payload = new java.util.LinkedHashMap<String, Object>();
        payload.put("passFail", true);
        payload.put("testDatetime", testDatetime);
        String payloadJson = new ObjectMapper().valueToTree(payload).toString();
        when(pricing.getFor(tenant)).thenReturn(new CenterPricingService.PricingConfig(
                9_500L, 50_000L, OffsetDateTime.now(), "admin@petc.test"));
        when(jdbc.queryForObject(
                contains("INSERT INTO submissions"), eq(String.class),
                eq(tenant), eq("lane-1"), eq("center-1"), eq("test-1"),
                eq(payloadJson), eq(9_500L)))
                .thenReturn("submission-1");
        var service = new SubmissionService(
                jdbc, new ObjectMapper(), pricing, wallet, audit, quota);

        String id = service.enqueue(
                tenant, "lane-1", "center-1", "test-1", payload);

        assertThat(id).isEqualTo("submission-1");
        verify(jdbc).queryForObject(
                contains("charge_snapshot_centavos = CASE"), eq(String.class),
                eq(tenant), eq("lane-1"), eq("center-1"), eq("test-1"),
                eq(payloadJson), eq(9_500L));
        verify(quota).reserve(tenant, "lane-1", "submission-1");
    }

    @Test
    void enqueueRejectsYesterdayTestBeforeItCanReserveOrPersist() {
        var service = new SubmissionService(jdbc, new ObjectMapper(), pricing, wallet, audit, quota);
        String yesterday = LocalDate.now(LaneQuotaService.BUSINESS_ZONE).minusDays(1) + "T10:00:00+08:00";

        assertThatThrownBy(() -> service.enqueue(
                "tenant-1", "lane-1", "center-1", "test-1", Map.of("testDatetime", yesterday)))
                .isInstanceOf(LateSubmissionException.class);

        verify(pricing, org.mockito.Mockito.never()).getFor(org.mockito.ArgumentMatchers.anyString());
        verifyNoInteractions(quota);
    }
}
