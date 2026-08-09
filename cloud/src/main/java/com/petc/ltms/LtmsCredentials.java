package com.petc.ltms;

import java.util.Arrays;

/** Password is supplied from a secret provider and is never serialised or logged. */
public final class LtmsCredentials {
    private final LtmsTokenKey key;
    private final char[] password;

    public LtmsCredentials(LtmsTokenKey key, char[] password) {
        this.key = key;
        if (password == null || password.length == 0) throw new IllegalArgumentException("LTMS password is required");
        this.password = password.clone();
    }
    public LtmsTokenKey key() { return key; }
    public String username() { return key.username(); }
    public char[] passwordCopy() { return password.clone(); }
    public void clearPassword() { Arrays.fill(password, '\0'); }
    @Override public String toString() { return "LtmsCredentials[key=" + key + ", password=[REDACTED]]"; }
}
