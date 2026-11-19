package com.petc.payments;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestController
@RequestMapping("/api/payments/paymongo/webhook")
public class PayMongoWebhookController {
    private final PayMongoWebhookVerifier verifier;
    private final PaymentWebhookService webhooks;
    private final PayMongoProperties properties;

    public PayMongoWebhookController(PayMongoWebhookVerifier verifier,
                                     PaymentWebhookService webhooks,
                                     PayMongoProperties properties) {
        this.verifier = verifier;
        this.webhooks = webhooks;
        this.properties = properties;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.OK)
    public Map<String, Boolean> receive(
            @RequestBody byte[] rawBody,
            @RequestHeader(value = "Paymongo-Signature", required = false) String signature,
            @RequestHeader(value = "X-Paymongo-Signature", required = false) String alternateSignature
    ) {
        String supplied = signature != null ? signature : alternateSignature;
        if (!verifier.verify(rawBody, supplied)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid PayMongo signature");
        }
        try {
            webhooks.receive(rawBody, properties.isLiveMode());
        } catch (IllegalArgumentException invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, invalid.getMessage());
        }
        return Map.of("received", true);
    }
}
