package com.petc.ltms;

import com.petc.ltms.config.LtmsCenterConfigRepository;

import java.util.function.Function;

/**
 * Resolves a center password only for the duration of an LTMS operation.
 * Implementations must not expose, log, or persist plaintext passwords.
 */
public interface LtmsCredentialsResolver {
    <T> T withCredentials(LtmsCenterConfigRepository.LtmsCenterConfig center, Function<LtmsCredentials, T> action);
}
