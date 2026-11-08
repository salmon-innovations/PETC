package com.petc.ltms;

/** Default JWT client; prevents authentication calls before commissioning. */
public final class DisabledLtmsJwtClient implements LtmsJwtClient {
    @Override public String authenticate(LtmsCredentials credentials) { throw new LtmsDisabledException(); }
}
