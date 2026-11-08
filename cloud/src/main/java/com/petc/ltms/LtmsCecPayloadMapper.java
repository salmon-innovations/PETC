package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.Set;

/**
 * Translates the immutable desktop submission bundle to LTMS's v2 CEC body.
 *
 * <p>This is intentionally only a serialization boundary. It does not select
 * a CEC number, call LTMS, or decide whether production uploads are enabled.
 * A caller must supply a previously allocated CEC number.</p>
 */
public final class LtmsCecPayloadMapper {
    private static final ZoneId PHILIPPINE_TIME = ZoneId.of("Asia/Manila");
    private static final DateTimeFormatter LTMS_TIMESTAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    private static final Set<String> PURPOSES = Set.of("FOR_RENEWAL", "FOR_INIT_REG", "FOR_COMPLIANCE");
    private static final Set<String> CLASSIFICATIONS = Set.of(
            "PRIVATE", "FOR_HIRE", "GOVERNMENT", "EXEMPT", "DIPLOMATIC");
    private static final Set<String> GROUPS = Set.of("LIGHT", "HEAVY", "MOTORCYCLE");

    private final ObjectMapper mapper;

    public LtmsCecPayloadMapper(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    /** Maps and validates a canonical submission JSON object for {@code /v2/cec/upload}. */
    public LtmsDtos.CecUploadRequest map(JsonNode canonicalSubmission, String cecNumber) {
        if (canonicalSubmission == null || !canonicalSubmission.isObject()) {
            throw invalid("canonical submission must be a JSON object");
        }
        String cec = required(cecNumber, "cecNumber");
        ObjectNode vehicleSource = requiredObject(canonicalSubmission, "vehicle");
        ObjectNode ownerSource = requiredObject(canonicalSubmission, "owner");
        ObjectNode inspectionSource = requiredObject(canonicalSubmission, "inspection");
        ObjectNode technicianSource = requiredObject(canonicalSubmission, "technician");
        ObjectNode readingsSource = requiredObject(canonicalSubmission, "readings");

        String purpose = upper(requiredText(inspectionSource, "purpose", "inspection.purpose"));
        if (!PURPOSES.contains(purpose)) throw invalid("inspection.purpose is invalid");

        String fuelType = normalizeFuel(requiredText(vehicleSource, "fuelType", "vehicle.fuelType"));
        String vehicleGroup = vehicleGroup(vehicleSource);
        if ("MOTORCYCLE".equals(vehicleGroup) && !"GAS".equals(fuelType)) {
            throw invalid("motorcycles must use GAS fuel_type");
        }
        String classification = classification(vehicleSource);

        String mvFileNumber = requiredText(vehicleSource, "mvNo", "vehicle.mvNo");
        String engineNumber = text(vehicleSource, "engineNo");
        String chassisNumber = text(vehicleSource, "chassisNo");
        if ("FOR_INIT_REG".equals(purpose) && (blank(engineNumber) || blank(chassisNumber))) {
            throw invalid("FOR_INIT_REG requires vehicle.engineNo and vehicle.chassisNo");
        }

        ObjectNode root = mapper.createObjectNode();
        root.set("owner", owner(ownerSource));
        root.set("vehicle", vehicle(canonicalSubmission, vehicleSource, mvFileNumber, engineNumber, chassisNumber,
                fuelType, vehicleGroup, classification));
        root.set("inspection", inspection(canonicalSubmission, inspectionSource, technicianSource,
                readingsSource, cec, purpose, fuelType));
        copyAccreditation(canonicalSubmission, root);
        return new LtmsDtos.CecUploadRequest(root);
    }

    private ObjectNode owner(ObjectNode source) {
        ObjectNode target = mapper.createObjectNode();
        String organization = text(source, "organization");
        String lastName = text(source, "lastName");
        String firstName = text(source, "firstName");
        String ownerType = upper(text(source, "ownerType"));
        if ("ORGANIZATION".equals(ownerType)) {
            target.put("organization", required(organization, "owner.organization"));
        } else {
            target.put("last_name", required(lastName, "owner.lastName"));
            target.put("first_name", required(firstName, "owner.firstName"));
            putText(target, "middle_name", text(source, "middleName"));
        }
        String address = required(text(source, "address"), "owner.address");
        String city = text(source, "city");
        target.put("address", blank(city) ? address : address + ", " + city);
        return target;
    }

    private ObjectNode vehicle(
            JsonNode canonical,
            ObjectNode source,
            String mvFileNumber,
            String engineNumber,
            String chassisNumber,
            String fuelType,
            String group,
            String classification
    ) {
        ObjectNode target = mapper.createObjectNode();
        putText(target, "plate_number", text(source, "plateNo", "plateNumber"));
        target.put("mv_file_number", mvFileNumber);
        putText(target, "engine_number", engineNumber);
        putText(target, "chassis_number", chassisNumber);
        target.put("fuel_type", fuelType);
        target.put("dotr_vehicle_group", group);
        target.put("classification", classification);
        if ("DIESEL".equals(fuelType)) {
            target.put("diesel_type", dieselType(source, canonical.path("engineFlags")));
        }
        return target;
    }

    private ObjectNode inspection(
            JsonNode canonical,
            ObjectNode inspectionSource,
            ObjectNode technicianSource,
            ObjectNode readings,
            String cecNumber,
            String purpose,
            String fuelType
    ) {
        ObjectNode target = mapper.createObjectNode();
        target.put("cec_number", cecNumber);
        target.put("inspection_date", inspectionTimestamp(requiredText(canonical, "testDatetime", "testDatetime")));
        target.put("purpose", purpose);
        target.put("technician", requiredText(technicianSource, "technicianName", "technician.technicianName"));

        if ("DIESEL".equals(fuelType)) {
            putReading(target, "ave_d", readings, "opacity_pct");
            putNull(target, "co", "co2", "o2", "nox", "temperature", "lambda", "hc");
            putReading(target, "rpm", readings, "rpm");
        } else {
            target.putNull("ave_d");
            putReading(target, "co", readings, "co_pct");
            putReading(target, "hc", readings, "hc_ppm");
            putReading(target, "co2", readings, "co2_pct");
            putReading(target, "o2", readings, "o2_pct");
            putReading(target, "nox", readings, "no_ppm");
            putReading(target, "temperature", readings, "oil_temp_c");
            putReading(target, "lambda", readings, "lambda_value");
            putReading(target, "rpm", readings, "rpm");
        }
        return target;
    }

    private void copyAccreditation(JsonNode canonical, ObjectNode root) {
        JsonNode source = canonical.path("accreditation");
        if (!source.isObject()) return;
        ObjectNode accreditation = mapper.createObjectNode();
        copyText(source, accreditation, "tesda_accr_no");
        copyText(source, accreditation, "tesda_exp_date");
        copyText(source, accreditation, "petc_accr_exp");
        copyText(source, accreditation, "petc_auth_exp");
        if (!accreditation.isEmpty()) root.set("accreditation", accreditation);
    }

    private static void copyText(JsonNode source, ObjectNode target, String field) {
        JsonNode value = source.get(field);
        if (value != null && value.isTextual() && !value.asText().isBlank()) target.put(field, value.asText().trim());
    }

    private static void putReading(ObjectNode target, String targetField, ObjectNode source, String sourceField) {
        JsonNode value = source.get(sourceField);
        if (value == null || value.isNull()) {
            target.putNull(targetField);
        } else if (value.isNumber()) {
            target.set(targetField, value);
        } else {
            throw invalid("readings." + sourceField + " must be a JSON number or null");
        }
    }

    private static void putNull(ObjectNode target, String... fields) {
        for (String field : fields) target.putNull(field);
    }

    private static String vehicleGroup(ObjectNode vehicle) {
        String explicit = upper(text(vehicle, "dotrVehicleGroup"));
        if (!blank(explicit)) {
            if (!GROUPS.contains(explicit)) throw invalid("vehicle.dotrVehicleGroup is invalid");
            return explicit;
        }
        String type = upper(text(vehicle, "vehicleType"));
        if ("MOTORCYCLE".equals(type)) return "MOTORCYCLE";
        if ("HEAVY".equals(type) || "TRUCK".equals(type) || "BUS".equals(type)) return "HEAVY";
        return "LIGHT";
    }

    private static String classification(ObjectNode vehicle) {
        String value = upper(text(vehicle, "classification"));
        if (blank(value)) return "PRIVATE";
        if ("PUBLIC".equals(value)) return "FOR_HIRE";
        if (!CLASSIFICATIONS.contains(value)) throw invalid("vehicle.classification is invalid");
        return value;
    }

    private static String normalizeFuel(String source) {
        String fuel = upper(source);
        // Older desktop payloads modelled motorcycle as a fuel. LTMS accepts
        // only GAS/DIESEL; its motorcycle value belongs in the vehicle group.
        if ("MOTORCYCLE".equals(fuel)) return "GAS";
        if (!"GAS".equals(fuel) && !"DIESEL".equals(fuel)) {
            throw invalid("vehicle.fuelType must be GAS or DIESEL");
        }
        return fuel;
    }

    private static String dieselType(ObjectNode vehicle, JsonNode engineFlags) {
        String explicit = upper(text(vehicle, "dieselType"));
        if ("TURBO".equals(explicit) || "NATURAL".equals(explicit)) return explicit;
        String turbo = upper(text(vehicle, "turbo"));
        if (blank(turbo)) turbo = upper(text(engineFlags, "turbo"));
        if ("TURBO".equals(turbo)) return "TURBO";
        if ("NON_TURBO".equals(turbo) || "NATURAL".equals(turbo)) return "NATURAL";
        throw invalid("DIESEL requires vehicle.dieselType or a TURBO/NON_TURBO engine flag");
    }

    private static String inspectionTimestamp(String raw) {
        try {
            return Instant.parse(raw).atZone(PHILIPPINE_TIME).toLocalDateTime().format(LTMS_TIMESTAMP);
        } catch (DateTimeParseException ignored) {
            try {
                return OffsetDateTime.parse(raw).atZoneSameInstant(PHILIPPINE_TIME).toLocalDateTime().format(LTMS_TIMESTAMP);
            } catch (DateTimeParseException noOffset) {
                try {
                    // A legacy canonical timestamp with no offset is already a
                    // Philippine local capture time, never dispatch time.
                    return LocalDateTime.parse(raw).format(LTMS_TIMESTAMP);
                } catch (DateTimeParseException invalid) {
                    throw invalid("testDatetime must be an ISO-8601 timestamp");
                }
            }
        }
    }

    private static ObjectNode requiredObject(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isObject()) throw invalid(field + " must be an object");
        return (ObjectNode) value;
    }

    private static String requiredText(JsonNode source, String field, String label) {
        return required(text(source, field), label);
    }

    private static String required(String value, String label) {
        if (blank(value)) throw invalid(label + " is required");
        return value.trim();
    }

    private static String text(JsonNode source, String... names) {
        for (String name : names) {
            JsonNode value = source.get(name);
            if (value != null && value.isTextual()) return value.asText().trim();
        }
        return "";
    }

    private static void putText(ObjectNode target, String name, String value) {
        if (!blank(value)) target.put(name, value.trim());
    }

    private static String upper(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException("Invalid LTMS upload payload: " + message);
    }
}
