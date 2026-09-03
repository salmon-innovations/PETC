package com.petc.payments;

public class PayMongoException extends RuntimeException {
    private final String code;

    public PayMongoException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() { return code; }
}
