package com.petc.ltms;

import org.junit.jupiter.api.Test;

import static com.petc.ltms.LtmsDtos.InspectionPurpose.FOR_INIT_REG;
import static com.petc.ltms.LtmsDtos.InspectionPurpose.FOR_RENEWAL;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class LtmsDtosTest {

    @Test
    void initialRegistrationRequiresEngineAndChassisWithoutExistingIdentifiers() {
        assertThatCode(() -> new LtmsDtos.VehicleSearchRequest(
                FOR_INIT_REG, null, null, "CHASSIS-1", "ENGINE-1", null))
                .doesNotThrowAnyException();

        assertThatIllegalArgumentException().isThrownBy(() -> new LtmsDtos.VehicleSearchRequest(
                FOR_INIT_REG, "ABC123", null, "CHASSIS-1", "ENGINE-1", null));
        assertThatIllegalArgumentException().isThrownBy(() -> new LtmsDtos.VehicleSearchRequest(
                FOR_INIT_REG, null, null, "CHASSIS-1", null, null));
    }

    @Test
    void nonInitialSearchAcceptsAnyDocumentedVehicleIdentifier() {
        assertThatCode(() -> new LtmsDtos.VehicleSearchRequest(
                FOR_RENEWAL, null, null, null, "ENGINE-1", null))
                .doesNotThrowAnyException();

        assertThatIllegalArgumentException().isThrownBy(() -> new LtmsDtos.VehicleSearchRequest(
                FOR_RENEWAL, null, null, null, null, null));
    }

    @Test
    void cecSearchRequiresExactlyOneIdentifier() {
        assertThatCode(() -> new LtmsDtos.CecSearchRequest("CEC-1", null))
                .doesNotThrowAnyException();
        assertThatCode(() -> new LtmsDtos.CecSearchRequest(null, "INBOX-1"))
                .doesNotThrowAnyException();

        assertThatIllegalArgumentException().isThrownBy(() -> new LtmsDtos.CecSearchRequest(null, null));
        assertThatIllegalArgumentException().isThrownBy(() -> new LtmsDtos.CecSearchRequest("CEC-1", "INBOX-1"));
    }
}
