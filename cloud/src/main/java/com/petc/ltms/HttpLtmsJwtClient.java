package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.config.LtmsSafetyGuard;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Live username/password JWT transport; constructed only in explicit live mode. */
final class HttpLtmsJwtClient implements LtmsJwtClient {
    private static final String AUTH_PATH = "/ords/dl_user_management/authentication/latest/authenticate";
    private final LtmsTransportProperties properties;
    private final ObjectMapper mapper;
    private final HttpClient client;

    HttpLtmsJwtClient(LtmsTransportProperties properties, LtmsSafetyGuard safetyGuard, ObjectMapper mapper) {
        properties.requireValidLiveConfiguration();
        safetyGuard.requirePermittedDestination(properties.getJwtBaseUrl());
        this.properties = properties;
        this.mapper = mapper;
        this.client = HttpClient.newBuilder().connectTimeout(properties.getConnectTimeout()).build();
    }

    @Override public String authenticate(LtmsCredentials credentials) {
        char[] password = credentials.passwordCopy();
        try {
            String body = mapper.writeValueAsString(Map.of("username", credentials.username(), "password", new String(password)));
            HttpRequest request = HttpRequest.newBuilder(properties.jwtEndpoint(AUTH_PATH))
                    .timeout(properties.getTotalTimeout()).header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                return extractRawToken(mapper, response.body());
            }
            LtmsDtos.Response decoded = LtmsResponseDecoder.decode(mapper, LtmsOperation.AUTHENTICATE, response.statusCode(), response.headers().map(), response.body());
            throw new LtmsRemoteException("LTMS JWT authentication failed", decoded.error().map(LtmsDtos.Error::code).orElse(null), decoded.inboxId().orElse(null));
        } catch (LtmsRemoteException exception) {
            throw exception;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new LtmsRemoteException("LTMS JWT authentication interrupted", null, null);
        } catch (Exception exception) {
            throw new LtmsRemoteException("LTMS JWT authentication transport failure", null, null);
        } finally {
            java.util.Arrays.fill(password, '\0');
        }
    }

    static String extractRawToken(ObjectMapper mapper, String body) throws Exception {
        // Historic LTMS samples are unquoted compact JWTs, which are not JSON.
        String trimmed = body == null ? "" : body.trim();
        if (trimmed.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) return trimmed;
        JsonNode node = mapper.readTree(trimmed);
        if (node != null && node.isTextual()) return node.textValue();
        throw new LtmsRemoteException("LTMS JWT response did not contain a compact token", null, null);
    }
}
