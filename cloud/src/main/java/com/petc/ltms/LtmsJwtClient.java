package com.petc.ltms;

/** Authentication transport boundary. Implementations must return the raw compact JWT only. */
@FunctionalInterface
public interface LtmsJwtClient {
    String authenticate(LtmsCredentials credentials);
}
