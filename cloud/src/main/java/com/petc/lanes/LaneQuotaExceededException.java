package com.petc.lanes;

import java.time.Instant;

/** Raised before a new test is accepted when its lane has no remaining CEC capacity. */
public class LaneQuotaExceededException extends RuntimeException {
    private final String laneId;
    private final int accepted;
    private final int reserved;
    private final int limit;
    private final Instant resetsAt;

    public LaneQuotaExceededException(String laneId, int accepted, int reserved, int limit, Instant resetsAt) {
        super("Lane daily upload limit reached");
        this.laneId = laneId;
        this.accepted = accepted;
        this.reserved = reserved;
        this.limit = limit;
        this.resetsAt = resetsAt;
    }

    public String laneId() { return laneId; }
    public int accepted() { return accepted; }
    public int reserved() { return reserved; }
    public int limit() { return limit; }
    public Instant resetsAt() { return resetsAt; }
}
