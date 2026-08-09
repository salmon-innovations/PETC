import { INSPECTION_PURPOSE_LABELS, type EmissionTest, type FuelType, type InspectionPurpose } from "../types";

export type TestResultFilter = "" | "PASS" | "FAIL" | "NOT_RECORDED";

export interface TestListFilterState {
  search: string;
  result: TestResultFilter;
  purpose: "" | InspectionPurpose;
  fuelType: "" | FuelType;
  testDate: string;
  ltmsState: string;
}

export const EMPTY_TEST_FILTERS: TestListFilterState = {
  search: "",
  result: "",
  purpose: "",
  fuelType: "",
  testDate: "",
  ltmsState: "",
};

export function filterEmissionTests(
  tests: EmissionTest[],
  filters: TestListFilterState,
): EmissionTest[] {
  const search = filters.search.trim().toLocaleLowerCase();
  const compactSearch = compact(search);

  return tests.filter((test) => {
    if (search) {
      const searchable = [
        test.plateNumber,
        test.certificateNo,
        test.submissionId,
        test.fuelType,
        INSPECTION_PURPOSE_LABELS[test.inspectionPurpose],
        test.ltmsState,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();

      if (!searchable.includes(search) && !compact(searchable).includes(compactSearch)) {
        return false;
      }
    }

    if (filters.result === "PASS" && test.passFail !== true) return false;
    if (filters.result === "FAIL" && test.passFail !== false) return false;
    if (filters.result === "NOT_RECORDED" && test.passFail !== null) return false;
    if (filters.purpose && test.inspectionPurpose !== filters.purpose) return false;
    if (filters.fuelType && test.fuelType !== filters.fuelType) return false;
    if (filters.ltmsState && (test.ltmsState ?? "PENDING") !== filters.ltmsState) return false;
    if (filters.testDate && localDateKey(test.startedAt) !== filters.testDate) return false;

    return true;
  });
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function localDateKey(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
