package com.petc.ltms;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;

/** Atomically allocates the center-owned CEC number required by LTMS. */
@Service
public class LtmsCecNumberAllocator {
    private static final ZoneId PHILIPPINE_TIME = ZoneId.of("Asia/Manila");

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final int orNumberWidth;

    public LtmsCecNumberAllocator(
            JdbcTemplate jdbc,
            @Value("${petc.ltms.cec-or-number-width:6}") int orNumberWidth
    ) {
        this(jdbc, Clock.systemUTC(), orNumberWidth);
    }

    LtmsCecNumberAllocator(JdbcTemplate jdbc, Clock clock, int orNumberWidth) {
        if (orNumberWidth < 1 || orNumberWidth > 12) {
            throw new IllegalArgumentException("petc.ltms.cec-or-number-width must be between 1 and 12");
        }
        this.jdbc = jdbc;
        this.clock = clock;
        this.orNumberWidth = orNumberWidth;
    }

    @Transactional
    public Allocation allocate(String tenantId, String petcCode) {
        int year = ZonedDateTime.now(clock).withZoneSameInstant(PHILIPPINE_TIME).getYear();
        Long next = jdbc.queryForObject("""
                INSERT INTO ltms_cec_number_sequences (tenant_id, sequence_year, last_value)
                VALUES (?::uuid, ?, 1)
                ON CONFLICT (tenant_id, sequence_year) DO UPDATE
                    SET last_value = ltms_cec_number_sequences.last_value + 1,
                        updated_at = now()
                RETURNING last_value
                """, Long.class, tenantId, year);
        if (next == null) throw new IllegalStateException("LTMS CEC sequence allocation returned no value");
        return format(year, petcCode, next, orNumberWidth);
    }

    /**
     * Returns the number already assigned to a submission, or allocates and
     * stores one exactly once while holding the submission row lock.
     */
    @Transactional
    public Allocation allocateForSubmission(String submissionId, String tenantId, String petcCode) {
        List<String> existing = jdbc.query("""
                SELECT cec_number
                  FROM submissions
                 WHERE id = ?::uuid AND tenant_id = ?::uuid
                 FOR UPDATE
                """, (rs, row) -> rs.getString("cec_number"), submissionId, tenantId);
        if (existing.isEmpty()) {
            throw new IllegalArgumentException("Submission does not belong to the specified tenant");
        }
        String current = existing.getFirst();
        if (current != null && !current.isBlank()) {
            return new Allocation(current, orPart(current, petcCode));
        }

        Allocation allocation = allocate(tenantId, petcCode);
        int updated = jdbc.update("""
                UPDATE submissions
                   SET cec_number = ?
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND cec_number IS NULL
                """, allocation.cecNumber(), submissionId, tenantId);
        if (updated != 1) throw new IllegalStateException("Unable to persist the allocated LTMS CEC number");
        return allocation;
    }

    static Allocation format(int year, String petcCode, long sequence, int width) {
        if (year < 2000 || year > 9999) throw new IllegalArgumentException("CEC year is invalid");
        String normalizedCode = petcCode == null ? "" : petcCode.trim();
        if (!normalizedCode.matches("\\d{1,5}")) {
            throw new IllegalArgumentException("LTMS PETC code must contain one to five digits");
        }
        normalizedCode = String.format("%05d", Integer.parseInt(normalizedCode));
        long maximum = powerOfTen(width) - 1;
        if (sequence < 1 || sequence > maximum) {
            throw new IllegalStateException("LTMS CEC OR-number sequence is exhausted for " + year);
        }
        String orNumber = String.format("%0" + width + "d", sequence);
        return new Allocation(year + normalizedCode + "0" + orNumber, orNumber);
    }

    private static long powerOfTen(int width) {
        long result = 1;
        for (int i = 0; i < width; i++) result *= 10;
        return result;
    }

    private static String orPart(String cecNumber, String petcCode) {
        String normalizedCode = petcCode == null ? "" : petcCode.trim();
        if (!normalizedCode.matches("\\d{1,5}")) return "";
        normalizedCode = String.format("%05d", Integer.parseInt(normalizedCode));
        String marker = normalizedCode + "0";
        int markerStart = cecNumber.indexOf(marker, 4);
        return markerStart < 0 ? "" : cecNumber.substring(markerStart + marker.length());
    }

    public record Allocation(String cecNumber, String orNumber) { }
}
