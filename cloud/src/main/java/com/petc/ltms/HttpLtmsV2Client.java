package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.LtmsDtos.*;
import com.petc.ltms.config.LtmsSafetyGuard;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The live PETC v2 transport. It can only be constructed by explicit enabled
 * configuration; no application code should create it directly.
 */
final class HttpLtmsV2Client implements LtmsV2Client {
    private final LtmsTransportProperties properties;
    private final LtmsSafetyGuard safetyGuard;
    private final ObjectMapper mapper;
    private final HttpClient client;

    HttpLtmsV2Client(LtmsTransportProperties properties, LtmsSafetyGuard safetyGuard, ObjectMapper mapper) {
        properties.requireValidLiveConfiguration();
        safetyGuard.requirePermittedDestination(properties.getPetcBaseUrl());
        this.properties = properties;
        this.safetyGuard = safetyGuard;
        this.mapper = mapper;
        this.client = HttpClient.newBuilder().connectTimeout(properties.getConnectTimeout()).build();
    }

    @Override public Response getLimits(LtmsRequestContext context, LimitsRequest request) {
        return get(LtmsOperation.LIMITS, context, "/v2/cec/limits", Map.of());
    }

    @Override public Response searchVehicle(LtmsRequestContext context, VehicleSearchRequest request) {
        Map<String, String> query = new LinkedHashMap<>();
        put(query, "purpose", request.purpose().name());
        put(query, "plate_number", request.plateNumber());
        put(query, "mv_file_number", request.mvFileNumber());
        put(query, "chassis_number", request.chassisNumber());
        put(query, "engine_number", request.engineNumber());
        put(query, "diesel_type", request.dieselType());
        return get(LtmsOperation.SEARCH_VEHICLE, context, "/v2/cec/search_vehicle", query);
    }

    @Override public Response upload(LtmsRequestContext context, CecUploadRequest request) {
        safetyGuard.requireUploadPermitted();
        return sendJson(LtmsOperation.UPLOAD, context, "POST", "/v2/cec/upload", request.payload());
    }

    @Override public Response replace(LtmsRequestContext context, CecReplaceRequest request) {
        safetyGuard.requireUploadPermitted();
        return sendJson(LtmsOperation.REPLACE, context, "PUT", "/v2/cec/replace", request.payload());
    }

    @Override public Response searchCec(LtmsRequestContext context, CecSearchRequest request) {
        Map<String, String> query = new LinkedHashMap<>();
        put(query, "cec_number", request.cecNumber());
        put(query, "inbox_id", request.inboxId());
        return get(LtmsOperation.SEARCH_CEC, context, "/v2/cec/search", query);
    }

    @Override public Response getUploadLimits(LtmsRequestContext context, UploadLimitsRequest request) {
        return get(LtmsOperation.UPLOAD_LIMITS, context, "/v2/cec/upload_limits",
                request.searchDate() == null ? Map.of() : Map.of("search_date", request.searchDate().toString()));
    }

    private Response get(LtmsOperation operation, LtmsRequestContext context, String path, Map<String, String> query) {
        URI endpoint = withQuery(properties.petcEndpoint(path), query);
        HttpRequest request = baseRequest(endpoint, context).GET().build();
        return execute(operation, request);
    }

    private Response sendJson(LtmsOperation operation, LtmsRequestContext context, String method, String path, com.fasterxml.jackson.databind.JsonNode body) {
        try {
            HttpRequest request = baseRequest(properties.petcEndpoint(path), context)
                    .method(method, HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
            return execute(operation, request);
        } catch (Exception e) {
            if (e instanceof LtmsRemoteException remote) throw remote;
            throw new LtmsRemoteException("Unable to serialize LTMS request", null, null);
        }
    }

    private HttpRequest.Builder baseRequest(URI endpoint, LtmsRequestContext context) {
        return HttpRequest.newBuilder(endpoint)
                .timeout(properties.getTotalTimeout())
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + context.rawJwt())
                .header("username", context.username())
                .header("business-id", context.businessId());
    }

    private Response execute(LtmsOperation operation, HttpRequest request) {
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            return LtmsResponseDecoder.decode(mapper, operation, response.statusCode(), response.headers().map(), response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LtmsRemoteException("LTMS call interrupted", null, null);
        } catch (Exception e) {
            // Deliberately omit the endpoint and exception details: they can contain request values.
            throw new LtmsRemoteException("LTMS transport failure", null, null);
        }
    }

    private static URI withQuery(URI endpoint, Map<String, String> query) {
        String encoded = query.entrySet().stream().filter(entry -> entry.getValue() != null && !entry.getValue().isBlank())
                .map(entry -> URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8) + "=" + URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8))
                .reduce((left, right) -> left + "&" + right).orElse("");
        return encoded.isEmpty() ? endpoint : URI.create(endpoint + "?" + encoded);
    }

    private static void put(Map<String, String> values, String key, String value) {
        if (value != null && !value.isBlank()) values.put(key, value);
    }
}
