package com.petc.common;

import com.petc.auth.AuthException;
import com.petc.lanes.LaneQuotaExceededException;
import com.petc.lanes.LateSubmissionException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(AuthException.class)
    public ProblemDetail handleAuth(AuthException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, ex.getMessage());
    }

    @ExceptionHandler(LaneQuotaExceededException.class)
    public ProblemDetail handleLaneQuota(LaneQuotaExceededException ex) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage());
        detail.setProperty("code", "LANE_DAILY_UPLOAD_LIMIT_REACHED");
        detail.setProperty("laneId", ex.laneId());
        detail.setProperty("accepted", ex.accepted());
        detail.setProperty("reserved", ex.reserved());
        detail.setProperty("limit", ex.limit());
        detail.setProperty("resetsAt", ex.resetsAt());
        return detail;
    }

    @ExceptionHandler(LateSubmissionException.class)
    public ProblemDetail handleLateSubmission(LateSubmissionException ex) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        detail.setProperty("code", "LATE_TEST_SUBMISSION_NOT_ALLOWED");
        return detail;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        String details = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, details);
    }

    /**
     * Deliberate status codes thrown by controllers (404, 409, ...) must keep
     * their status and reason; without this the catch-all below would rewrite
     * every one of them as a 500 "Unexpected error".
     */
    @ExceptionHandler(ResponseStatusException.class)
    public ProblemDetail handleResponseStatus(ResponseStatusException ex) {
        return ProblemDetail.forStatusAndDetail(ex.getStatusCode(), ex.getReason());
    }

    /** Access denied must stay 403 rather than surface as a server error. */
    @ExceptionHandler(AuthorizationDeniedException.class)
    public ProblemDetail handleAccessDenied(AuthorizationDeniedException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "Access denied");
    }

    /**
     * A missing required header (X-Center-Key on the ingest and center-wallet
     * APIs) is a malformed request, not a server fault. Without this it reaches
     * the catch-all below and reports 500, which tells an integrator their
     * request broke the server rather than that they omitted a header.
     */
    @ExceptionHandler(MissingRequestHeaderException.class)
    public ProblemDetail handleMissingHeader(MissingRequestHeaderException ex) {
        return ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "Missing required header: " + ex.getHeaderName());
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail handleGeneric(Exception ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected error");
    }
}
