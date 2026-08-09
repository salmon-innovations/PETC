package com.petc.submissions;

import com.petc.ingest.CenterKeyValidator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SubmissionsControllerTest {

    @Mock private SubmissionService service;
    @Mock private CenterKeyValidator validator;

    @Test
    void submitPersistsTheCenterIdDerivedFromTheValidatedKey() {
        var context = new CenterKeyValidator.CenterContext("tenant-a", "center-a", "ACTIVE", null);
        when(validator.validateContext("key-a")).thenReturn(context);
        when(service.enqueue("tenant-a", "center-a", "test-a", Map.of("value", "x")))
                .thenReturn("submission-a");
        var controller = new SubmissionsController(service, validator);

        var response = controller.submit("key-a", new SubmissionsController.SubmitRequest(
                "center-a", "test-a", Map.of("value", "x")));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        verify(validator).requireMatchingCenter(context, "center-a");
        verify(service).enqueue("tenant-a", "center-a", "test-a", Map.of("value", "x"));
    }
}
