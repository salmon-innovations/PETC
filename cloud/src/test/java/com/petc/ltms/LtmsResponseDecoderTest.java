package com.petc.ltms;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class LtmsResponseDecoderTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test void decodesFixtureForEveryPetcOperation() {
        assertSuccess("limits-success.json", LtmsOperation.LIMITS);
        assertSuccess("search-vehicle-success.json", LtmsOperation.SEARCH_VEHICLE);
        assertSuccess("upload-success.json", LtmsOperation.UPLOAD);
        assertSuccess("replace-success.json", LtmsOperation.REPLACE);
        assertSuccess("search-cec-success.json", LtmsOperation.SEARCH_CEC);
        assertSuccess("upload-limits-success.json", LtmsOperation.UPLOAD_LIMITS);
    }

    @Test void classifiesEveryDocumentedCodeFromFixtureWithoutUsingHttpStatusAsRetryPolicy() {
        for (var entry : LtmsErrorCodeCatalog.all().entrySet()) {
            var response = LtmsResponseDecoder.decode(mapper, LtmsOperation.UPLOAD, 400, Map.of(), fixture("error.json").replace("{{CODE}}", entry.getKey().toString()));
            assertEquals("SUPPORT-001", response.inboxId().orElseThrow());
            assertEquals(entry.getValue().outcome(), response.outcome(), "code " + entry.getKey());
            assertEquals(List.of(new LtmsDtos.Reason("R-001", "fixture reason")), response.error().orElseThrow().reasons());
        }
    }

    @Test void extractsSupportFieldsFromHeadersWhenBodyIsEmpty() {
        var response = LtmsResponseDecoder.decode(mapper, LtmsOperation.UPLOAD, 503,
                Map.of("X-Inbox-Id", List.of("HEADER-1"), "X-Error-Code", List.of("926"),
                        "error_msg", List.of("LTMS is still processing the request")), "{}");
        assertEquals("HEADER-1", response.inboxId().orElseThrow());
        assertEquals(LtmsOutcome.DEFER, response.outcome());
        assertEquals("LTMS is still processing the request", response.error().orElseThrow().message());
    }

    private void assertSuccess(String file, LtmsOperation operation) {
        var response = LtmsResponseDecoder.decode(mapper, operation, 200, Map.of(), fixture(file));
        assertTrue(response.isSuccess());
        assertEquals(LtmsOutcome.SUCCESS, response.outcome());
        assertTrue(response.inboxId().isPresent());
    }

    private static String fixture(String file) {
        try (InputStream input = LtmsResponseDecoderTest.class.getResourceAsStream("/fixtures/ltms/" + file)) {
            assertNotNull(input, file);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8).trim();
        } catch (Exception e) { throw new AssertionError(e); }
    }
}
