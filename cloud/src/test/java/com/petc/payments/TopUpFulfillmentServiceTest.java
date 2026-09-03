package com.petc.payments;

import com.petc.wallet.WalletService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TopUpFulfillmentServiceTest {
    @Mock JdbcTemplate jdbc;
    @Mock WalletService wallet;

    @Test
    void matchingSucceededQrCreditsExactlyTheProviderPayment() {
        when(jdbc.queryForList(anyString(), eq("pi_1"))).thenReturn(List.of(Map.of(
                "id", "11111111-1111-1111-1111-111111111111",
                "tenant_id", "22222222-2222-2222-2222-222222222222",
                "amount_centavos", 50_000L, "currency", "PHP",
                "status", "AWAITING_PAYMENT", "livemode", false)));
        TopUpFulfillmentService service = new TopUpFulfillmentService(jdbc, wallet);

        service.fulfill(new QrPaymentGateway.PaymentState(
                "pi_1", "pay_1", "succeeded", 50_000L, "PHP", "qrph", false));

        verify(wallet).topUpFromProvider(
                "22222222-2222-2222-2222-222222222222", 50_000L, "PAYMONGO", "pay_1");
    }

    @Test
    void mismatchedAmountNeverCreditsWallet() {
        when(jdbc.queryForList(anyString(), eq("pi_1"))).thenReturn(List.of(Map.of(
                "id", "11111111-1111-1111-1111-111111111111",
                "tenant_id", "22222222-2222-2222-2222-222222222222",
                "amount_centavos", 50_000L, "currency", "PHP",
                "status", "AWAITING_PAYMENT", "livemode", false)));
        TopUpFulfillmentService service = new TopUpFulfillmentService(jdbc, wallet);

        service.fulfill(new QrPaymentGateway.PaymentState(
                "pi_1", "pay_1", "succeeded", 49_999L, "PHP", "qrph", false));

        verify(wallet, never()).topUpFromProvider(anyString(), anyLong(), anyString(), anyString());
    }
}
