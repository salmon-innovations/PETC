package com.petc.lanes;

/** A desktop may only submit a test performed on today's Asia/Manila date. */
public class LateSubmissionException extends RuntimeException {
    public LateSubmissionException(String message) { super(message); }
}
