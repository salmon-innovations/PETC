import { INSPECTION_PURPOSE_LABELS, type FuelType, type InspectionPurpose } from "../types";
import { EMPTY_TEST_FILTERS, type TestListFilterState, type TestResultFilter } from "../utils/testFilters";

interface TestListFiltersProps {
  filters: TestListFilterState;
  onChange: (filters: TestListFilterState) => void;
  ltmsStates?: string[];
  resultIncludesNotRecorded?: boolean;
}

export function TestListFilters({
  filters,
  onChange,
  ltmsStates,
  resultIncludesNotRecorded = false,
}: TestListFiltersProps) {
  const update = <K extends keyof TestListFilterState>(key: K, value: TestListFilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className={`grid items-end gap-3 sm:grid-cols-2 ${ltmsStates ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
        <label className="sm:col-span-2 xl:col-span-2">
          <span className="sr-only">Search tests</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            placeholder="Search plate, certificate, submission…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>

        <FilterSelect
          label="Result"
          value={filters.result}
          onChange={(value) => update("result", value as TestResultFilter)}
          options={[
            ["PASS", "Passed"],
            ["FAIL", "Failed"],
            ...(resultIncludesNotRecorded ? [["NOT_RECORDED", "Not recorded"]] : []),
          ] as Array<[string, string]>}
        />

        <FilterSelect
          label="Purpose"
          value={filters.purpose}
          onChange={(value) => update("purpose", value as "" | InspectionPurpose)}
          options={Object.entries(INSPECTION_PURPOSE_LABELS)}
        />

        <FilterSelect
          label="Fuel"
          value={filters.fuelType}
          onChange={(value) => update("fuelType", value as "" | FuelType)}
          options={[
            ["GAS", "Gasoline"],
            ["DIESEL", "Diesel"],
            ["MOTORCYCLE", "Motorcycle"],
          ]}
        />

        {ltmsStates && (
          <FilterSelect
            label="LTMS status"
            value={filters.ltmsState}
            onChange={(value) => update("ltmsState", value)}
            options={ltmsStates.map((state) => [state, state.replaceAll("_", " ")])}
          />
        )}

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600">Test date</span>
          <input
            type="date"
            value={filters.testDate}
            onChange={(event) => update("testDate", event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>
      </div>

      {hasFilters && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_TEST_FILTERS })}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        <option value="">All</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
