import { describe, expect, it } from "vitest";
import type { EmissionTest } from "../types";
import { EMPTY_TEST_FILTERS, filterEmissionTests } from "./testFilters";

const tests: EmissionTest[] = [
  {
    id: "test-1",
    plateNumber: "ABC 1234",
    fuelType: "GAS",
    inspectionPurpose: "FOR_RENEWAL",
    passFail: true,
    startedAt: "2026-08-09T02:00:00.000Z",
    completedAt: "2026-08-09T02:10:00.000Z",
    ltmsState: "ACCEPTED",
    certificateNo: "CEC-001",
    submissionId: "submission-one",
    photoCount: 3,
  },
  {
    id: "test-2",
    plateNumber: "XYZ-987",
    fuelType: "DIESEL",
    inspectionPurpose: "FOR_INIT_REG",
    passFail: false,
    startedAt: "2026-08-10T02:00:00.000Z",
    completedAt: "2026-08-10T02:10:00.000Z",
    ltmsState: "PENDING",
    certificateNo: null,
    submissionId: null,
    photoCount: 2,
  },
];

describe("filterEmissionTests", () => {
  it("matches plates even when punctuation differs", () => {
    const result = filterEmissionTests(tests, { ...EMPTY_TEST_FILTERS, search: "abc-1234" });
    expect(result.map((test) => test.id)).toEqual(["test-1"]);
  });

  it("searches certificate numbers", () => {
    const result = filterEmissionTests(tests, { ...EMPTY_TEST_FILTERS, search: "CEC-001" });
    expect(result.map((test) => test.id)).toEqual(["test-1"]);
  });

  it("combines result, purpose, fuel, and status filters", () => {
    const result = filterEmissionTests(tests, {
      ...EMPTY_TEST_FILTERS,
      result: "FAIL",
      purpose: "FOR_INIT_REG",
      fuelType: "DIESEL",
      ltmsState: "PENDING",
    });
    expect(result.map((test) => test.id)).toEqual(["test-2"]);
  });
});
