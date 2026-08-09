package com.petc.ingest;

import com.petc.auth.AuthException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class CenterKeyValidatorTest {

    private final CenterKeyValidator validator = new CenterKeyValidator(
            mock(JdbcTemplate.class), mock(PasswordEncoder.class), false,
            "", "dev-center", "Dev Center");

    @Test
    void acceptsOnlyTheCenterIdDerivedFromTheValidatedKey() {
        var context = new CenterKeyValidator.CenterContext("tenant-a", "center-a", "ACTIVE", null);

        assertThatCode(() -> validator.requireMatchingCenter(context, "center-a"))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> validator.requireMatchingCenter(context, "center-b"))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("does not match");
    }
}
