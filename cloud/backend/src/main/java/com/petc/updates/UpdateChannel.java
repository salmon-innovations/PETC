package com.petc.updates;

/**
 * Represents a release channel (stable / beta).
 * Generates the latest.yml content that electron-updater expects.
 */
public record UpdateChannel(String name, String version, String baseUrl) {

    public String toYml() {
        String installerName = "petc-setup-" + version + ".exe";
        return String.format("""
                version: %s
                files:
                  - url: %s/%s
                    sha512: TODO_FILL_SHA512
                    size: 0
                path: %s/%s
                sha512: TODO_FILL_SHA512
                releaseDate: '%s'
                """,
                version,
                baseUrl, installerName,
                baseUrl, installerName,
                java.time.LocalDate.now()
        );
    }
}
