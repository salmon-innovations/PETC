package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AwsSecretsManagerLtmsCredentialsResolverTest {
    private final AwsSecretsManagerLtmsCredentialsResolver resolver =
            new AwsSecretsManagerLtmsCredentialsResolver(Mockito.mock(SecretsManagerClient.class), new ObjectMapper());

    @Test void acceptsRawPasswordSecret() {
        assertEquals("not-json-password", resolver.passwordFrom("not-json-password"));
    }

    @Test void acceptsJsonPasswordSecret() {
        assertEquals("secret-value", resolver.passwordFrom("{\"password\":\"secret-value\"}"));
    }

    @Test void rejectsJsonWithoutPassword() {
        assertThrows(IllegalStateException.class, () -> resolver.passwordFrom("{\"token\":\"not-a-password\"}"));
    }
}
