package com.petc.ltms;

import java.util.Map;
import java.util.Optional;

/**
 * Maintained subset of codes supplied with the PETC v2 and JWT materials.
 * Meanings that need LTMS confirmation intentionally remain conservative.
 */
public final class LtmsErrorCodeCatalog {
    public record Entry(int code, LtmsOutcome outcome, String operatorAction) { }

    private static final Map<Integer, Entry> ENTRIES = Map.ofEntries(
            Map.entry(301, new Entry(301, LtmsOutcome.MISSING_PRIVILEGE, "Contact LTMS to grant the center user required PETC privileges.")),
            Map.entry(310, new Entry(310, LtmsOutcome.AUTH_BLOCKED, "Stop automated authentication and have operations verify the LTMS account.")),
            Map.entry(311, new Entry(311, LtmsOutcome.AUTH_REFRESH_ONCE, "Refresh the cached JWT once, then retry the original LTMS request once.")),
            Map.entry(312, new Entry(312, LtmsOutcome.REUSE_CACHED_TOKEN, "Reload the shared token cache; do not generate another JWT.")),
            Map.entry(313, new Entry(313, LtmsOutcome.AUTH_BLOCKED, "Stop automated authentication and have operations verify the LTMS account.")),
            Map.entry(314, new Entry(314, LtmsOutcome.AUTH_BLOCKED, "Stop automated authentication and have operations verify the LTMS account.")),
            Map.entry(317, new Entry(317, LtmsOutcome.AUTH_BLOCKED, "Stop automated authentication and have operations verify the LTMS account.")),
            Map.entry(318, new Entry(318, LtmsOutcome.AUTH_BLOCKED, "Stop automated authentication and have operations verify the LTMS account.")),
            Map.entry(320, new Entry(320, LtmsOutcome.AUTH_BLOCKED, "Stop automated authentication and have operations verify the LTMS account.")),
            Map.entry(321, new Entry(321, LtmsOutcome.MISSING_PRIVILEGE, "Contact LTMS to grant the center user required PETC privileges.")),
            Map.entry(905, new Entry(905, LtmsOutcome.DEFER_TO_NEXT_DAY, "Daily upload limit reached; defer until LTMS permits another upload.")),
            Map.entry(908, new Entry(908, LtmsOutcome.ACTION_REQUIRED, "Correct the inspection date after confirming the LTMS time boundary.")),
            Map.entry(917, new Entry(917, LtmsOutcome.FAILED_EVALUATION, "Show LTMS evaluation reasons and use the returned next inspection time.")),
            Map.entry(926, new Entry(926, LtmsOutcome.DEFER, "LTMS is processing this record; retry only with a controlled delay.")),
            Map.entry(943, new Entry(943, LtmsOutcome.RECONCILE, "Search the CEC before any replay; a prior request may have committed.")),
            Map.entry(955, new Entry(955, LtmsOutcome.DEFER, "Wait until LTMS permits the next inspection.")),
            Map.entry(961, new Entry(961, LtmsOutcome.INVALID_REQUEST, "Correct the required non-zero emission reading.")),
            Map.entry(962, new Entry(962, LtmsOutcome.INVALID_REQUEST, "Correct the required non-zero emission reading.")),
            Map.entry(973, new Entry(973, LtmsOutcome.ACTION_REQUIRED, "Correct timestamp or clock skew before retrying.")),
            Map.entry(976, new Entry(976, LtmsOutcome.RECONCILE, "Search LTMS before retrying; the inspection time may already exist."))
    );

    private LtmsErrorCodeCatalog() { }

    public static Optional<Entry> find(Integer code) { return Optional.ofNullable(code).map(ENTRIES::get); }
    public static LtmsOutcome classify(Integer code) { return find(code).map(Entry::outcome).orElse(LtmsOutcome.UNKNOWN); }
    public static Map<Integer, Entry> all() { return ENTRIES; }
}
