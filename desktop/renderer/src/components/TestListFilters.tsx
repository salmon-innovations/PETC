import { INSPECTION_PURPOSE_LABELS, type FuelType, type InspectionPurpose } from "../types";
import { EMPTY_TEST_FILTERS, type TestListFilterState, type TestResultFilter } from "../utils/testFilters";
import { MagnifyingGlass, ArrowsClockwise } from "@phosphor-icons/react";

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
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4">
      <div className={`grid items-end gap-3.5 sm:grid-cols-2 ${ltmsStates ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
        {/* Search input with icon */}
        <label className="sm:col-span-2 xl:col-span-2 space-y-1.5 block">
          <span className="text-xs font-bold text-slate-700 block">Search Test Records</span>
          <div className="relative">
            <MagnifyingGlass size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => update("search", event.target.value)}
              placeholder="Filter by plate, cert #, or ID…"
              className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[42px]"
            />
          </div>
        </label>

        <FilterSelect
          label="Pass / Fail"
          value={filters.result}
          onChange={(value) => update("result", value as TestResultFilter)}
          options={[
            ["PASS", "Passed Only"],
            ["FAIL", "Failed Only"],
            ...(resultIncludesNotRecorded ? [["NOT_RECORDED", "Not Recorded"]] : []),
          ] as Array<[string, string]>}
        />

        <FilterSelect
          label="Inspection Purpose"
          value={filters.purpose}
          onChange={(value) => update("purpose", value as "" | InspectionPurpose)}
          options={Object.entries(INSPECTION_PURPOSE_LABELS)}
        />

        <FilterSelect
          label="Fuel Category"
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
            label="LTMS Registry State"
            value={filters.ltmsState}
            onChange={(value) => update("ltmsState", value)}
            options={ltmsStates.map((state) => [state, state.replaceAll("_", " ")])}
          />
        )}

        <label className="space-y-1.5 block">
          <span className="text-xs font-bold text-slate-700 block">Test Date</span>
          <input
            type="date"
            value={filters.testDate}
            onChange={(event) => update("testDate", event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[42px]"
          />
        </label>
      </div>

      {hasFilters && (
        <div className="flex justify-end pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_TEST_FILTERS })}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowsClockwise size={14} weight="bold" />
            <span>Reset All Filters</span>
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
    <label className="space-y-1.5 block">
      <span className="text-xs font-bold text-slate-700 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs min-h-[42px] cursor-pointer"
      >
        <option value="">All Categories</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
