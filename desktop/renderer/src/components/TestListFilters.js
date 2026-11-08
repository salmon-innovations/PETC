import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { INSPECTION_PURPOSE_LABELS } from "../types";
import { EMPTY_TEST_FILTERS } from "../utils/testFilters";
export function TestListFilters({ filters, onChange, ltmsStates, resultIncludesNotRecorded = false, }) {
    const update = (key, value) => {
        onChange({ ...filters, [key]: value });
    };
    const hasFilters = Object.values(filters).some(Boolean);
    return (_jsxs("div", { className: "rounded-xl border border-gray-200 bg-white p-4 shadow-sm", children: [_jsxs("div", { className: `grid items-end gap-3 sm:grid-cols-2 ${ltmsStates ? "xl:grid-cols-7" : "xl:grid-cols-6"}`, children: [_jsxs("label", { className: "sm:col-span-2 xl:col-span-2", children: [_jsx("span", { className: "sr-only", children: "Search tests" }), _jsx("input", { type: "search", value: filters.search, onChange: (event) => update("search", event.target.value), placeholder: "Search plate, certificate, submission\u2026", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" })] }), _jsx(FilterSelect, { label: "Result", value: filters.result, onChange: (value) => update("result", value), options: [
                            ["PASS", "Passed"],
                            ["FAIL", "Failed"],
                            ...(resultIncludesNotRecorded ? [["NOT_RECORDED", "Not recorded"]] : []),
                        ] }), _jsx(FilterSelect, { label: "Purpose", value: filters.purpose, onChange: (value) => update("purpose", value), options: Object.entries(INSPECTION_PURPOSE_LABELS) }), _jsx(FilterSelect, { label: "Fuel", value: filters.fuelType, onChange: (value) => update("fuelType", value), options: [
                            ["GAS", "Gasoline"],
                            ["DIESEL", "Diesel"],
                            ["MOTORCYCLE", "Motorcycle"],
                        ] }), ltmsStates && (_jsx(FilterSelect, { label: "LTMS status", value: filters.ltmsState, onChange: (value) => update("ltmsState", value), options: ltmsStates.map((state) => [state, state.replaceAll("_", " ")]) })), _jsxs("label", { children: [_jsx("span", { className: "mb-1 block text-xs font-medium text-gray-600", children: "Test date" }), _jsx("input", { type: "date", value: filters.testDate, onChange: (event) => update("testDate", event.target.value), className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" })] })] }), hasFilters && (_jsx("div", { className: "mt-3 flex justify-end", children: _jsx("button", { type: "button", onClick: () => onChange({ ...EMPTY_TEST_FILTERS }), className: "text-xs font-medium text-blue-600 hover:text-blue-800", children: "Clear filters" }) }))] }));
}
function FilterSelect({ label, value, options, onChange, }) {
    return (_jsxs("label", { children: [_jsx("span", { className: "mb-1 block text-xs font-medium text-gray-600", children: label }), _jsxs("select", { value: value, onChange: (event) => onChange(event.target.value), className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200", children: [_jsx("option", { value: "", children: "All" }), options.map(([optionValue, optionLabel]) => (_jsx("option", { value: optionValue, children: optionLabel }, optionValue)))] })] }));
}
