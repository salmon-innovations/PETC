import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { sidecarClient } from "../../api/sidecarClient";
import { useAuthStore } from "../../store/authStore";
import { evaluateEmission } from "../../utils/emissionLimits";
const EMPTY_VEHICLE = {
    plateNo: "",
    mvNo: "",
    engineNo: "",
    chassisNo: "",
    orType: "MVRR",
    crDate: "",
    crNo: "",
    districtOffice: "",
    make: "",
    series: "",
    vehicleType: "CAR",
    yearModel: new Date().getFullYear(),
    color: "",
    transmission: "A/T",
    fuelType: "GAS",
};
const EMPTY_OWNER = {
    ownerType: "INDIVIDUAL",
    lastName: "",
    firstName: "",
    middleName: "",
    organization: "",
    address: "",
    city: "",
};
const PHOTO_TYPES = [
    { type: "FRONT", label: "Front of vehicle", required: true },
    { type: "REAR", label: "Rear of vehicle", required: true },
    { type: "RESULT", label: "Emission result printout", required: false },
    { type: "OTHER", label: "Additional", required: false },
];
const STEP_LABELS = ["Vehicle", "Owner", "Results", "Technician", "Photos", "Review"];
export default function LtmsUploadPage() {
    const [selected, setSelected] = useState(null);
    const { data: pending = [] } = useQuery({
        queryKey: ["tests", "pending-ltms"],
        queryFn: async () => {
            const base = await window.petcBridge.getSidecarUrl();
            const response = await fetch(`${base}/tests?ltms_state=PENDING`);
            if (!response.ok)
                throw new Error("Unable to load pending tests");
            return response.json();
        },
        refetchInterval: 30_000,
    });
    if (selected) {
        return _jsx(UploadWizard, { test: selected, onDone: () => setSelected(null), onCancel: () => setSelected(null) });
    }
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-6 space-y-5", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "LTMS Upload Queue" }), _jsx("p", { className: "text-sm text-gray-500", children: "Completed local tests waiting for registry submission." })] }), pending.length === 0 ? (_jsx("div", { className: "bg-white rounded-lg shadow px-6 py-12 text-center text-gray-500", children: "No tests pending LTMS submission." })) : (_jsx("div", { className: "bg-white rounded-lg shadow divide-y", children: pending.map((test) => (_jsxs("div", { className: "flex items-center justify-between px-5 py-3", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-sm text-gray-800", children: test.plateNumber }), _jsxs("p", { className: "text-xs text-gray-500", children: [test.fuelType, " \u00B7 ", test.startedAt ? new Date(test.startedAt).toLocaleString() : "No date"] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: clsx("rounded-full px-2 py-0.5 text-xs font-medium", test.passFail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"), children: test.passFail ? "PASS" : "FAIL" }), _jsx("button", { onClick: () => setSelected(test), className: "rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white font-medium hover:bg-blue-700", children: "Open Wizard" })] })] }, test.id))) }))] }));
}
function UploadWizard({ test, onDone, onCancel }) {
    const [step, setStep] = useState(1);
    const [vehicle, setVehicle] = useState({ ...EMPTY_VEHICLE, plateNo: test.plateNumber, fuelType: test.fuelType });
    const [owner, setOwner] = useState(EMPTY_OWNER);
    const [engineFlags, setEngineFlags] = useState({
        turbo: "NON_TURBO",
        aspiration: "N_ASPIRATED",
        condition: "CONVENTIONAL",
    });
    const user = useAuthStore((state) => state.user);
    const [technician, setTechnician] = useState({
        technicianName: user?.fullName ?? "Operator",
        tesdaCertNo: user?.tesdaCertNo ?? "TESDA-MOCK-001",
        certificationNo: user?.certificationNo ?? "PETC-CERT-MOCK",
    });
    const [lookup, setLookup] = useState(null);
    const qc = useQueryClient();
    const { data: detail } = useQuery({
        queryKey: ["test-detail", test.id],
        queryFn: () => sidecarClient.getTestDetail(test.id),
    });
    const lookupMutation = useMutation({
        mutationFn: (plate) => sidecarClient.lookupVehicle(plate),
        onSuccess: (result) => {
            setLookup(result);
            if (result.vehicle)
                setVehicle(mapVehicle(result.vehicle));
            if (result.owner)
                setOwner(result.owner);
        },
    });
    useEffect(() => {
        lookupMutation.mutate(test.plateNumber);
    }, [test.plateNumber]);
    const verdict = useMemo(() => evaluateEmission(vehicle.fuelType, detail?.readings ?? {}, engineFlags), [detail?.readings, engineFlags, vehicle.fuelType]);
    const payload = useMemo(() => ({
        centerId: "dev-center",
        centerName: "PETC Center",
        testId: test.id,
        testDatetime: detail?.testedAt ?? test.completedAt ?? test.startedAt,
        vehicle,
        owner,
        engineFlags,
        readings: detail?.readings ?? {},
        verdict,
        technician,
        photos: detail?.photos ?? [],
    }), [detail, engineFlags, owner, technician, test, vehicle, verdict]);
    const submitMutation = useMutation({
        mutationFn: () => sidecarClient.submitUpload(payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tests", "pending-ltms"] });
            qc.invalidateQueries({ queryKey: ["test-detail", test.id] });
        },
    });
    const goNext = () => setStep((current) => Math.min(6, current + 1));
    const goBack = () => setStep((current) => Math.max(1, current - 1));
    return (_jsxs("div", { className: "max-w-5xl mx-auto p-6 space-y-5", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { onClick: onCancel, className: "text-sm text-gray-500 hover:text-gray-700", children: "Back" }), _jsxs("div", { children: [_jsxs("h1", { className: "text-xl font-bold text-gray-800", children: ["LTMS Upload - ", test.plateNumber] }), _jsx("p", { className: "text-xs text-gray-500", children: lookupStatusText(lookup, lookupMutation.isPending) })] })] }), _jsx("button", { onClick: () => lookupMutation.mutate(vehicle.plateNo), disabled: lookupMutation.isPending, className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50", children: lookupMutation.isPending ? "Looking up..." : "Lookup Plate" })] }), _jsx("div", { className: "grid grid-cols-6 gap-2", children: STEP_LABELS.map((label, index) => {
                    const number = (index + 1);
                    return (_jsxs("button", { onClick: () => setStep(number), className: clsx("rounded-md py-2 text-xs font-semibold", step === number ? "bg-blue-600 text-white" : number < step ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"), children: [number, ". ", label] }, label));
                }) }), step === 1 && (_jsx(VehicleStep, { vehicle: vehicle, lookup: lookup, onChange: setVehicle, onNext: goNext })), step === 2 && _jsx(OwnerStep, { owner: owner, onChange: setOwner, onBack: goBack, onNext: goNext }), step === 3 && (_jsx(ResultsStep, { fuelType: vehicle.fuelType, readings: detail?.readings ?? {}, flags: engineFlags, verdict: verdict, onChange: setEngineFlags, onBack: goBack, onNext: goNext })), step === 4 && (_jsx(TechnicianStep, { technician: technician, onChange: setTechnician, onBack: goBack, onNext: goNext })), step === 5 && (_jsx(PhotosStep, { testId: test.id, photos: detail?.photos ?? [], onBack: goBack, onNext: goNext })), step === 6 && (_jsx(ReviewStep, { payload: payload, result: submitMutation.data, isPending: submitMutation.isPending, isError: submitMutation.isError, onBack: goBack, onDone: onDone, onSubmit: () => submitMutation.mutate() }))] }));
}
function VehicleStep({ vehicle, lookup, onChange, onNext }) {
    const set = (key, value) => onChange({ ...vehicle, [key]: value });
    const valid = vehicle.plateNo && vehicle.make && vehicle.series && vehicle.engineNo && vehicle.chassisNo;
    return (_jsxs("section", { className: "bg-white rounded-lg shadow p-5 space-y-4", children: [_jsx(StepHeading, { title: "Step 1 - Plate Lookup + Vehicle Details" }), _jsxs("div", { className: "grid grid-cols-3 gap-4", children: [_jsx(TextField, { label: "Plate No", value: vehicle.plateNo, onChange: (value) => set("plateNo", value.toUpperCase()) }), _jsx(TextField, { label: "MV No", value: vehicle.mvNo, onChange: (value) => set("mvNo", value), badge: badgeFor("mvNo", vehicle.mvNo, lookup?.vehicle?.mvNo) }), _jsx(TextField, { label: "Engine No", value: vehicle.engineNo, onChange: (value) => set("engineNo", value), badge: badgeFor("engineNo", vehicle.engineNo, lookup?.vehicle?.engineNo) }), _jsx(TextField, { label: "Chassis No", value: vehicle.chassisNo, onChange: (value) => set("chassisNo", value), badge: badgeFor("chassisNo", vehicle.chassisNo, lookup?.vehicle?.chassisNo) }), _jsx(SelectField, { label: "OR Type", value: vehicle.orType, options: ["MVRR", "MVRS"], onChange: (value) => set("orType", value), badge: badgeFor("orType", vehicle.orType, lookup?.vehicle?.orType) }), _jsx(TextField, { label: "CR Date", type: "date", value: vehicle.crDate, onChange: (value) => set("crDate", value), badge: badgeFor("crDate", vehicle.crDate, lookup?.vehicle?.crDate) }), _jsx(TextField, { label: "CR No", value: vehicle.crNo, onChange: (value) => set("crNo", value), badge: badgeFor("crNo", vehicle.crNo, lookup?.vehicle?.crNo) }), _jsx(SelectField, { label: "District Office", value: vehicle.districtOffice, options: ["1368 - PASAY CITY DISTRICT OFFICE", "1301 - QUEZON CITY DISTRICT OFFICE", "1401 - MAKATI DISTRICT OFFICE"], onChange: (value) => set("districtOffice", value), badge: badgeFor("districtOffice", vehicle.districtOffice, lookup?.vehicle?.districtOffice) }), _jsx(TextField, { label: "Make", value: vehicle.make, onChange: (value) => set("make", value.toUpperCase()), badge: badgeFor("make", vehicle.make, lookup?.vehicle?.make) }), _jsx(TextField, { label: "Series", value: vehicle.series, onChange: (value) => set("series", value.toUpperCase()), badge: badgeFor("series", vehicle.series, lookup?.vehicle?.series) }), _jsx(SelectField, { label: "Vehicle Type", value: vehicle.vehicleType, options: ["CAR", "MOTORCYCLE", "TRUCK", "BUS", "JEEPNEY"], onChange: (value) => set("vehicleType", value), badge: badgeFor("vehicleType", vehicle.vehicleType, lookup?.vehicle?.vehicleType) }), _jsx(TextField, { label: "Year Model", type: "number", value: String(vehicle.yearModel), onChange: (value) => set("yearModel", Number(value || 0)), badge: badgeFor("yearModel", String(vehicle.yearModel), lookup?.vehicle ? String(lookup.vehicle.yearModel) : undefined) }), _jsx(TextField, { label: "Color", value: vehicle.color, onChange: (value) => set("color", value.toUpperCase()), badge: badgeFor("color", vehicle.color, lookup?.vehicle?.color) }), _jsx(Segment, { label: "Transmission", value: vehicle.transmission, options: ["M/T", "A/T"], onChange: (value) => set("transmission", value) }), _jsx(Segment, { label: "Fuel Type", value: vehicle.fuelType, options: ["GAS", "DIESEL", "MOTORCYCLE"], onChange: (value) => set("fuelType", value) })] }), _jsx(FooterNav, { nextDisabled: !valid, onNext: onNext })] }));
}
function OwnerStep({ owner, onChange, onBack, onNext }) {
    const set = (key, value) => onChange({ ...owner, [key]: value });
    const valid = owner.ownerType === "ORGANIZATION"
        ? owner.organization && owner.address && owner.city
        : owner.lastName && owner.firstName && owner.address && owner.city;
    return (_jsxs("section", { className: "bg-white rounded-lg shadow p-5 space-y-4", children: [_jsx(StepHeading, { title: "Step 2 - Vehicle Owner" }), _jsx(Segment, { label: "Owner Type", value: owner.ownerType, options: ["INDIVIDUAL", "ORGANIZATION"], onChange: (value) => set("ownerType", value) }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [owner.ownerType === "INDIVIDUAL" ? (_jsxs(_Fragment, { children: [_jsx(TextField, { label: "Last Name", value: owner.lastName, onChange: (value) => set("lastName", value.toUpperCase()) }), _jsx(TextField, { label: "First Name", value: owner.firstName, onChange: (value) => set("firstName", value.toUpperCase()) }), _jsx(TextField, { label: "Middle", value: owner.middleName, onChange: (value) => set("middleName", value.toUpperCase()) })] })) : (_jsx(TextField, { label: "Organization", value: owner.organization, onChange: (value) => set("organization", value.toUpperCase()) })), _jsx(TextField, { label: "Address", value: owner.address, onChange: (value) => set("address", value) }), _jsx(TextField, { label: "City", value: owner.city, onChange: (value) => set("city", value) })] }), _jsx(FooterNav, { nextDisabled: !valid, onBack: onBack, onNext: onNext })] }));
}
function ResultsStep({ fuelType, readings, flags, verdict, onChange, onBack, onNext }) {
    const set = (key, value) => onChange({ ...flags, [key]: value });
    return (_jsxs("section", { className: "bg-white rounded-lg shadow p-5 space-y-4", children: [_jsx(StepHeading, { title: "Step 3 - Engine Flags + Emission Test Results" }), _jsxs("div", { className: "grid grid-cols-3 gap-4", children: [_jsx(Segment, { label: "Turbo", value: flags.turbo, options: ["TURBO", "NON_TURBO"], onChange: (value) => set("turbo", value) }), _jsx(Segment, { label: "Aspiration", value: flags.aspiration, options: ["ELEVATION", "N_ASPIRATED"], onChange: (value) => set("aspiration", value) }), _jsx(Segment, { label: "Condition", value: flags.condition, options: ["REBUILT", "CONVENTIONAL"], onChange: (value) => set("condition", value) })] }), _jsx(ReadingsGrid, { readings: readings }), _jsxs("div", { className: clsx("rounded-md border px-4 py-3", verdict.pass ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"), children: [_jsxs("p", { className: "font-semibold", children: [fuelType, " verdict: ", verdict.label] }), verdict.reasons.length > 0 && _jsx("p", { className: "text-sm", children: verdict.reasons.join("; ") })] }), _jsx(FooterNav, { onBack: onBack, onNext: onNext })] }));
}
function TechnicianStep({ technician, onChange, onBack, onNext }) {
    const set = (key, value) => onChange({ ...technician, [key]: value });
    const valid = technician.technicianName && technician.tesdaCertNo && technician.certificationNo;
    return (_jsxs("section", { className: "bg-white rounded-lg shadow p-5 space-y-4", children: [_jsx(StepHeading, { title: "Step 4 - Technician / Certification" }), _jsxs("div", { className: "grid grid-cols-3 gap-4", children: [_jsx(TextField, { label: "Technician Name", value: technician.technicianName, onChange: (value) => set("technicianName", value) }), _jsx(TextField, { label: "TESDA Cert. No", value: technician.tesdaCertNo, onChange: (value) => set("tesdaCertNo", value) }), _jsx(TextField, { label: "Certification No", value: technician.certificationNo, onChange: (value) => set("certificationNo", value) })] }), _jsx(FooterNav, { nextDisabled: !valid, onBack: onBack, onNext: onNext })] }));
}
function PhotosStep({ testId, photos, onBack, onNext }) {
    const qc = useQueryClient();
    const captureMutation = useMutation({
        mutationFn: (photoType) => sidecarClient.capturePhoto({ testId, photoType }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["test-detail", testId] }),
    });
    const hasFront = photos.some((photo) => photo.photoType === "FRONT");
    const hasRear = photos.some((photo) => photo.photoType === "REAR");
    return (_jsxs("section", { className: "bg-white rounded-lg shadow p-5 space-y-4", children: [_jsx(StepHeading, { title: "Step 5 - Photos" }), _jsx("div", { className: "grid grid-cols-2 gap-4", children: PHOTO_TYPES.map((item) => {
                    const captured = photos.filter((photo) => photo.photoType === item.type);
                    return (_jsxs("div", { className: "rounded-md border border-gray-200 p-3 space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("p", { className: "text-sm font-semibold text-gray-700", children: item.label }), item.required && _jsx("span", { className: "text-xs text-red-600", children: "Required" })] }), captured.length === 0 ? (_jsx("p", { className: "text-xs text-gray-500", children: "No photo yet." })) : (_jsx("ul", { className: "space-y-1", children: captured.map((photo) => (_jsx("li", { className: "truncate text-xs font-mono text-gray-600", children: photo.filePath }, photo.id))) })), _jsx("button", { onClick: () => captureMutation.mutate(item.type), disabled: captureMutation.isPending, className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50", children: captureMutation.isPending ? "Capturing..." : captured.length ? "Retake / Add" : "Capture" })] }, item.type));
                }) }), _jsx(FooterNav, { nextDisabled: !hasFront || !hasRear, onBack: onBack, onNext: onNext })] }));
}
function ReviewStep({ payload, result, isPending, isError, onBack, onDone, onSubmit }) {
    const vehicle = payload.vehicle;
    const owner = payload.owner;
    const verdict = payload.verdict;
    if (result) {
        return (_jsxs("section", { className: clsx("rounded-lg shadow p-8 text-center space-y-3", result.state === "ACCEPTED" ? "bg-green-50 border border-green-200" : result.state === "PENDING" ? "bg-yellow-50 border border-yellow-200" : "bg-red-50 border border-red-200"), children: [_jsx("p", { className: "text-xl font-bold", children: result.state === "ACCEPTED" ? "Submitted and printed" : result.state === "PENDING" ? "Queued for retry" : "Rejected" }), result.certificateNo && _jsxs("p", { className: "text-sm text-green-700", children: ["Certificate No: ", _jsx("strong", { children: result.certificateNo })] }), result.rejectionReason && _jsx("p", { className: "text-sm text-red-700", children: result.rejectionReason }), _jsx("button", { onClick: onDone, className: "rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700", children: "Done" })] }));
    }
    return (_jsxs("section", { className: "bg-white rounded-lg shadow p-5 space-y-4", children: [_jsx(StepHeading, { title: "Step 6 - Review & Submit" }), _jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [_jsx(SummaryBlock, { title: "Vehicle", rows: [
                            ["Plate", vehicle.plateNo],
                            ["Vehicle", `${vehicle.yearModel} ${vehicle.make} ${vehicle.series}`],
                            ["Fuel", vehicle.fuelType],
                            ["Engine / Chassis", `${vehicle.engineNo} / ${vehicle.chassisNo}`],
                        ] }), _jsx(SummaryBlock, { title: "Owner", rows: [
                            ["Type", owner.ownerType],
                            ["Name", owner.ownerType === "ORGANIZATION" ? owner.organization : `${owner.firstName} ${owner.middleName} ${owner.lastName}`],
                            ["Address", `${owner.address}, ${owner.city}`],
                        ] }), _jsx(SummaryBlock, { title: "Verdict", rows: [
                            ["Result", verdict.label],
                            ["Reason", verdict.reasons.length ? verdict.reasons.join("; ") : "Within configured mock limits"],
                        ] }), _jsx(SummaryBlock, { title: "Photos", rows: [
                            ["Attached", `${payload.photos.length}`],
                        ] })] }), isError && _jsx("p", { className: "text-sm text-red-600", children: "Submission failed before it reached the sidecar." }), _jsxs("div", { className: "flex justify-between", children: [_jsx("button", { onClick: onBack, disabled: isPending, className: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50", children: "Back" }), _jsx("button", { onClick: onSubmit, disabled: isPending, className: "rounded-md bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50", children: isPending ? "Submitting..." : "Submit to LTMS" })] })] }));
}
function StepHeading({ title }) {
    return _jsx("h2", { className: "text-sm font-bold uppercase tracking-wide text-gray-700", children: title });
}
function TextField({ label, value, type = "text", badge, onChange }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsxs("span", { className: "flex items-center gap-2 text-xs font-medium text-gray-600", children: [label, badge && _jsx("span", { className: clsx("rounded-full px-1.5 py-0.5 text-[10px]", badge === "Edited" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"), children: badge })] }), _jsx("input", { type: type, value: value, onChange: (event) => onChange(event.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }));
}
function SelectField({ label, value, options, badge, onChange }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsxs("span", { className: "flex items-center gap-2 text-xs font-medium text-gray-600", children: [label, badge && _jsx("span", { className: clsx("rounded-full px-1.5 py-0.5 text-[10px]", badge === "Edited" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"), children: badge })] }), _jsxs("select", { value: value, onChange: (event) => onChange(event.target.value), className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm", children: [_jsx("option", { value: "", children: "Select..." }), options.map((option) => _jsx("option", { value: option, children: option }, option))] })] }));
}
function Segment({ label, value, options, onChange }) {
    return (_jsxs("div", { className: "space-y-1", children: [_jsx("p", { className: "text-xs font-medium text-gray-600", children: label }), _jsx("div", { className: "flex rounded-md border border-gray-300 p-0.5", children: options.map((option) => (_jsx("button", { type: "button", onClick: () => onChange(option), className: clsx("flex-1 rounded px-2 py-1.5 text-xs font-semibold", value === option ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"), children: option.replace(/_/g, ".") }, option))) })] }));
}
function FooterNav({ nextDisabled = false, onBack, onNext }) {
    return (_jsxs("div", { className: "flex justify-between pt-2", children: [onBack ? _jsx("button", { onClick: onBack, className: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50", children: "Back" }) : _jsx("span", {}), _jsx("button", { onClick: onNext, disabled: nextDisabled, className: "rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50", children: "Next" })] }));
}
function ReadingsGrid({ readings }) {
    const entries = Object.entries(readings);
    return (_jsx("div", { className: "grid grid-cols-4 gap-3", children: entries.length === 0 ? (_jsx("p", { className: "col-span-4 text-sm text-gray-500", children: "No analyzer readings found for this test." })) : entries.map(([key, value]) => (_jsxs("div", { className: "rounded-md border border-gray-200 px-3 py-2", children: [_jsx("p", { className: "text-[11px] uppercase text-gray-500", children: key.replace(/_/g, " ") }), _jsx("p", { className: "font-mono text-sm font-semibold text-gray-800", children: value ?? "N/A" })] }, key))) }));
}
function SummaryBlock({ title, rows }) {
    return (_jsxs("div", { className: "rounded-md border border-gray-200 p-3", children: [_jsx("p", { className: "mb-2 text-xs font-bold uppercase text-gray-500", children: title }), _jsx("dl", { className: "space-y-1", children: rows.map(([label, value]) => (_jsxs("div", { className: "flex justify-between gap-4", children: [_jsx("dt", { className: "text-gray-500", children: label }), _jsx("dd", { className: "text-right font-medium text-gray-800", children: value || "N/A" })] }, label))) })] }));
}
function mapVehicle(vehicle) {
    return {
        plateNo: vehicle.plateNo ?? vehicle.plateNumber,
        mvNo: vehicle.mvNo ?? "",
        engineNo: vehicle.engineNo ?? "",
        chassisNo: vehicle.chassisNo ?? "",
        orType: vehicle.orType ?? "MVRR",
        crDate: vehicle.crDate ?? "",
        crNo: vehicle.crNo ?? "",
        districtOffice: vehicle.districtOffice ?? "",
        make: vehicle.make ?? "",
        series: vehicle.series ?? vehicle.model ?? "",
        vehicleType: vehicle.vehicleType ?? "CAR",
        yearModel: vehicle.yearModel ?? vehicle.year ?? new Date().getFullYear(),
        color: vehicle.color ?? "",
        transmission: vehicle.transmission ?? "A/T",
        fuelType: vehicle.fuelType ?? "GAS",
    };
}
function badgeFor(_field, value, original) {
    if (original === undefined || original === null || original === "")
        return undefined;
    return String(value) === String(original) ? "From LTMS" : "Edited";
}
function lookupStatusText(lookup, pending) {
    if (pending)
        return "Looking up registry data...";
    if (!lookup)
        return "Mock lookup has not run yet.";
    if (!lookup.found)
        return "Plate not found. Complete the fields manually.";
    if (lookup.source === "LTMS_CACHE")
        return `From LTMS cache (${lookup.fetchedAt ? new Date(lookup.fetchedAt).toLocaleString() : "cached"})`;
    return "From LTMS mock registry.";
}
