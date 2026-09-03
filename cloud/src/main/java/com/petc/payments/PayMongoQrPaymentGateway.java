package com.petc.payments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/** Dynamic Payment Intent + QR Ph adapter. Secret-key calls remain cloud-side. */
final class PayMongoQrPaymentGateway implements QrPaymentGateway {
    private final PayMongoProperties properties;
    private final ObjectMapper mapper;
    private final HttpClient client;
    private final String authorization;

    PayMongoQrPaymentGateway(PayMongoProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
        this.client = HttpClient.newBuilder().connectTimeout(properties.getConnectTimeout()).build();
        this.authorization = "Basic " + Base64.getEncoder().encodeToString(
                (properties.getSecretKey() + ":").getBytes(StandardCharsets.UTF_8));
    }

    @Override public boolean available() { return true; }

    @Override
    public CreatedQr create(String localTopupId, long amountCentavos) {
        var intentAttributes = mapper.createObjectNode();
        intentAttributes.put("amount", amountCentavos);
        intentAttributes.put("currency", "PHP");
        intentAttributes.put("description", "PETC prepaid wallet reload " + localTopupId);
        intentAttributes.set("payment_method_allowed", mapper.createArrayNode().add("qrph"));
        intentAttributes.set("metadata", mapper.createObjectNode()
                .put("petc_topup_id", localTopupId)
                .put("purpose", "prepaid_wallet_reload"));
        JsonNode intent = post("/v1/payment_intents", "pi-" + localTopupId,
                mapper.createObjectNode().set("data",
                        mapper.createObjectNode().set("attributes", intentAttributes)));
        String intentId = required(intent, "/data/id");
        String clientKey = required(intent, "/data/attributes/client_key");

        var methodAttributes = mapper.createObjectNode();
        methodAttributes.put("type", "qrph");
        methodAttributes.put("expiry_seconds", properties.getQrExpirySeconds());
        JsonNode method = post("/v1/payment_methods", "pm-" + localTopupId,
                mapper.createObjectNode().set("data",
                        mapper.createObjectNode().set("attributes", methodAttributes)));
        String methodId = required(method, "/data/id");

        // A process may have stopped after a successful attach but before the
        // local row was updated. Resource-creation idempotency returns the
        // original create response, so retrieve the intent before replaying
        // attach. An already-attached intent must not be attached twice.
        JsonNode current = get("/v1/payment_intents/" + intentId);
        String currentStatus = text(current.at("/data/attributes/status"));
        if (currentStatus != null && !"awaiting_payment_method".equalsIgnoreCase(currentStatus)) {
            return createdQr(intentId, methodId, current);
        }

        JsonNode attached = post("/v1/payment_intents/" + intentId + "/attach", null,
                mapper.createObjectNode().set("data", mapper.createObjectNode().set("attributes",
                        mapper.createObjectNode().put("payment_method", methodId).put("client_key", clientKey))));
        return createdQr(intentId, methodId, attached);
    }

    private CreatedQr createdQr(String intentId, String methodId, JsonNode root) {
        String qrImage = firstText(root,
                "/data/attributes/next_action/code/image_url",
                "/data/attributes/next_action/code/image");
        String status = text(root.at("/data/attributes/status"));
        if (qrImage == null && !"succeeded".equalsIgnoreCase(status)) {
            throw new PayMongoException("invalid_provider_response", "PayMongo did not return a QR image");
        }
        String testUrl = firstText(root,
                "/data/attributes/next_action/code/test_url",
                "/data/attributes/next_action/redirect/url");
        return new CreatedQr(intentId, methodId, qrImage, testUrl,
                Instant.now().plusSeconds(properties.getQrExpirySeconds()), properties.isLiveMode());
    }

    @Override
    public PaymentState retrieve(String paymentIntentId) {
        JsonNode root = get("/v1/payment_intents/" + paymentIntentId);
        JsonNode attrs = root.at("/data/attributes");
        String status = text(attrs.get("status"));
        long amount = attrs.path("amount").asLong(-1);
        String currency = text(attrs.get("currency"));
        boolean liveMode = attrs.has("livemode") ? attrs.path("livemode").asBoolean() : properties.isLiveMode();
        String paymentId = null;
        String paymentStatus = null;
        String sourceType = null;
        JsonNode payments = attrs.path("payments");
        if (payments.isArray() && !payments.isEmpty()) {
            JsonNode payment = payments.get(0);
            paymentId = text(payment.get("id"));
            JsonNode paymentAttrs = payment.has("attributes") ? payment.path("attributes") : payment;
            paymentStatus = text(paymentAttrs.get("status"));
            sourceType = text(paymentAttrs.at("/source/type"));
            if (amount < 0) amount = paymentAttrs.path("amount").asLong(-1);
            if (currency == null) currency = text(paymentAttrs.get("currency"));
        }
        if ("paid".equalsIgnoreCase(paymentStatus)) status = "succeeded";
        return new PaymentState(paymentIntentId, paymentId, status, amount, currency, sourceType, liveMode);
    }

    private JsonNode get(String path) {
        HttpRequest request = base(path).GET().build();
        return execute(request);
    }

    private JsonNode post(String path, String idempotencyKey, JsonNode body) {
        try {
            HttpRequest.Builder builder = base(path).POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
            if (idempotencyKey != null) builder.header("Idempotency-Key", idempotencyKey);
            return execute(builder.build());
        } catch (PayMongoException e) {
            throw e;
        } catch (Exception e) {
            throw new PayMongoException("request_serialization_failed", "Could not prepare PayMongo request");
        }
    }

    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create(properties.getBaseUrl().toString() + path))
                .timeout(properties.getRequestTimeout())
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("Authorization", authorization);
    }

    private JsonNode execute(HttpRequest request) {
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new PayMongoException("provider_rejected_request",
                        "PayMongo rejected the request (HTTP " + response.statusCode() + ")");
            }
            return mapper.readTree(response.body());
        } catch (PayMongoException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PayMongoException("provider_interrupted", "PayMongo request was interrupted");
        } catch (Exception e) {
            throw new PayMongoException("provider_unavailable", "PayMongo is temporarily unavailable");
        }
    }

    private static String required(JsonNode root, String pointer) {
        String value = text(root.at(pointer));
        if (value == null) throw new PayMongoException("invalid_provider_response", "PayMongo response was incomplete");
        return value;
    }

    private static String firstText(JsonNode root, String... pointers) {
        for (String pointer : pointers) {
            String value = text(root.at(pointer));
            if (value != null) return value;
        }
        return null;
    }

    private static String text(JsonNode node) {
        return node == null || node.isMissingNode() || node.isNull() || !node.isValueNode()
                ? null : node.asText();
    }
}
