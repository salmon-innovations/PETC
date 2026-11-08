package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.ltms.config.LtmsCenterConfigRepository;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueResponse;

import java.util.Arrays;
import java.util.Objects;
import java.util.function.Function;

/** Cloud-only password resolver backed by the ECS task role's Secrets Manager access. */
public final class AwsSecretsManagerLtmsCredentialsResolver implements LtmsCredentialsResolver {
    private final SecretsManagerClient secrets;
    private final ObjectMapper mapper;

    public AwsSecretsManagerLtmsCredentialsResolver(SecretsManagerClient secrets, ObjectMapper mapper) {
        this.secrets = Objects.requireNonNull(secrets, "secrets");
        this.mapper = Objects.requireNonNull(mapper, "mapper");
    }

    @Override
    public <T> T withCredentials(LtmsCenterConfigRepository.LtmsCenterConfig center, Function<LtmsCredentials, T> action) {
        Objects.requireNonNull(center, "center");
        Objects.requireNonNull(action, "action");
        char[] password = null;
        LtmsCredentials credentials = null;
        try {
            GetSecretValueResponse secret = secrets.getSecretValue(request -> request.secretId(center.passwordSecretReference()));
            password = passwordFrom(secret.secretString()).toCharArray();
            credentials = new LtmsCredentials(new LtmsTokenKey(
                    center.centerId(), center.environment().name(), center.ltmsUsername()), password);
            return action.apply(credentials);
        } finally {
            if (credentials != null) credentials.clearPassword();
            if (password != null) Arrays.fill(password, '\0');
        }
    }

    /** Accepts either a raw secret string or the documented JSON {"password":"..."} shape. */
    String passwordFrom(String secretString) {
        if (secretString == null || secretString.isBlank()) {
            throw new IllegalStateException("LTMS password secret is empty");
        }
        String value = secretString;
        try {
            JsonNode parsed = mapper.readTree(secretString);
            if (parsed != null && parsed.isObject()) {
                JsonNode password = parsed.get("password");
                if (password == null || !password.isTextual()) {
                    throw new IllegalStateException("LTMS JSON secret must contain a non-empty password field");
                }
                value = password.textValue();
            }
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception ignored) {
            // A raw password is not JSON and is a supported secret shape.
        }
        if (value == null || value.isBlank()) throw new IllegalStateException("LTMS password secret is empty");
        return value;
    }
}
