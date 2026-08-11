-- Shared, encrypted LTMS JWT cache.  Passwords never enter this table.
CREATE TABLE ltms_token_cache (
    center_id          TEXT        NOT NULL,
    environment        TEXT        NOT NULL,
    username           TEXT        NOT NULL,
    token_ciphertext   BYTEA       NOT NULL,
    nonce              BYTEA       NOT NULL,
    issued_at          TIMESTAMPTZ NOT NULL,
    jwt_expires_at     TIMESTAMPTZ NOT NULL,
    cache_expires_at   TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (center_id, environment, username),
    CONSTRAINT ltms_token_cache_expiry_ordered CHECK (
        issued_at < jwt_expires_at AND issued_at < cache_expires_at AND cache_expires_at <= jwt_expires_at
    ),
    CONSTRAINT ltms_token_cache_nonce_length CHECK (octet_length(nonce) = 12),
    CONSTRAINT ltms_token_cache_ciphertext_nonempty CHECK (octet_length(token_ciphertext) > 16)
);

CREATE INDEX idx_ltms_token_cache_expiry ON ltms_token_cache(cache_expires_at);
