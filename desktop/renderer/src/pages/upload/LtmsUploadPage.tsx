import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { sidecarClient, type LtmsSubmitResponse, type VehicleLookupResponse } from "../../api/sidecarClient";
import { useAuthStore } from "../../store/authStore";
import type { EmissionTest, EmissionTestDetail, FuelType, OwnerInfo, TestPhoto, VehicleInfo } from "../../types";
import { evaluateEmission, type EngineFlags } from "../../utils/emissionLimits";

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
type PhotoType = TestPhoto["photoType"];

type VehicleForm = {
  plateNo: string;
  mvNo: string;
  engineNo: string;
  chassisNo: string;
  orType: string;
  crDate: string;
  crNo: string;
  districtOffice: string;
  make: string;
  series: string;
  vehicleType: string;
  yearModel: number;
  color: string;
  transmission: "M/T" | "A/T";
  fuelType: FuelType;
};

type OwnerForm = OwnerInfo;

type TechnicianForm = {
  technicianName: string;
  tesdaCertNo: string;
  certificationNo: string;
};

const EMPTY_VEHICLE: VehicleForm = {
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

const EMPTY_OWNER: OwnerForm = {
  ownerType: "INDIVIDUAL",
  lastName: "",
  firstName: "",
  middleName: "",
  organization: "",
  address: "",
  city: "",
};

const PHOTO_TYPES: { type: PhotoType; label: string; required: boolean }[] = [
  { type: "FRONT", label: "Front of vehicle", required: true },
  { type: "REAR", label: "Rear of vehicle", required: true },
  { type: "RESULT", label: "Emission result printout", required: false },
  { type: "OTHER", label: "Additional", required: false },
];

const STEP_LABELS = ["Vehicle", "Owner", "Results", "Technician", "Photos", "Review"] as const;

export default function LtmsUploadPage() {
  const [selected, setSelected] = useState<EmissionTest | null>(null);

  const { data: pending = [] } = useQuery<EmissionTest[]>({
    queryKey: ["tests", "pending-ltms"],
    queryFn: async () => {
      const base = await window.petcBridge.getSidecarUrl();
      const response = await fetch(`${base}/tests?ltms_state=PENDING`);
      if (!response.ok) throw new Error("Unable to load pending tests");
      return response.json();
    },
    refetchInterval: 30_000,
  });

  if (selected) {
    return <UploadWizard test={selected} onDone={() => setSelected(null)} onCancel={() => setSelected(null)} />;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800">LTMS Upload Queue</h1>
        <p className="text-sm text-gray-500">Completed local tests waiting for registry submission.</p>
      </div>

      {pending.length === 0 ? (
        <div className="bg-white rounded-lg shadow px-6 py-12 text-center text-gray-500">
          No tests pending LTMS submission.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y">
          {pending.map((test) => (
            <div key={test.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-semibold text-sm text-gray-800">{test.plateNumber}</p>
                <p className="text-xs text-gray-500">
                  {test.fuelType} · {test.startedAt ? new Date(test.startedAt).toLocaleString() : "No date"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={clsx(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  test.passFail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                )}>
                  {test.passFail ? "PASS" : "FAIL"}
                </span>
                <button
                  onClick={() => setSelected(test)}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white font-medium hover:bg-blue-700"
                >
                  Open Wizard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadWizard({ test, onDone, onCancel }: { test: EmissionTest; onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<WizardStep>(1);
  const [vehicle, setVehicle] = useState<VehicleForm>({ ...EMPTY_VEHICLE, plateNo: test.plateNumber, fuelType: test.fuelType });
  const [owner, setOwner] = useState<OwnerForm>(EMPTY_OWNER);
  const [engineFlags, setEngineFlags] = useState<EngineFlags>({
    turbo: "NON_TURBO",
    aspiration: "N_ASPIRATED",
    condition: "CONVENTIONAL",
  });
  const user = useAuthStore((state) => state.user);
  const [technician, setTechnician] = useState<TechnicianForm>({
    technicianName: user?.fullName ?? "Operator",
    tesdaCertNo: user?.tesdaCertNo ?? "TESDA-MOCK-001",
    certificationNo: user?.certificationNo ?? "PETC-CERT-MOCK",
  });
  const [lookup, setLookup] = useState<VehicleLookupResponse | null>(null);

  const qc = useQueryClient();
  const { data: detail } = useQuery({
    queryKey: ["test-detail", test.id],
    queryFn: () => sidecarClient.getTestDetail(test.id),
  });

  const lookupMutation = useMutation({
    mutationFn: (plate: string) => sidecarClient.lookupVehicle(plate),
    onSuccess: (result) => {
      setLookup(result);
      if (result.vehicle) setVehicle(mapVehicle(result.vehicle));
      if (result.owner) setOwner(result.owner);
    },
  });

  useEffect(() => {
    lookupMutation.mutate(test.plateNumber);
  }, [test.plateNumber]);

  const verdict = useMemo(
    () => evaluateEmission(vehicle.fuelType, detail?.readings ?? {}, engineFlags),
    [detail?.readings, engineFlags, vehicle.fuelType],
  );

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

  const submitMutation = useMutation<LtmsSubmitResponse>({
    mutationFn: () => sidecarClient.submitUpload(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tests", "pending-ltms"] });
      qc.invalidateQueries({ queryKey: ["test-detail", test.id] });
    },
  });

  const goNext = () => setStep((current) => Math.min(6, current + 1) as WizardStep);
  const goBack = () => setStep((current) => Math.max(1, current - 1) as WizardStep);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">Back</button>
          <div>
            <h1 className="text-xl font-bold text-gray-800">LTMS Upload - {test.plateNumber}</h1>
            <p className="text-xs text-gray-500">{lookupStatusText(lookup, lookupMutation.isPending)}</p>
          </div>
        </div>
        <button
          onClick={() => lookupMutation.mutate(vehicle.plateNo)}
          disabled={lookupMutation.isPending}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {lookupMutation.isPending ? "Looking up..." : "Lookup Plate"}
        </button>
      </div>

      <div className="grid grid-cols-6 gap-2">
        {STEP_LABELS.map((label, index) => {
          const number = (index + 1) as WizardStep;
          return (
            <button
              key={label}
              onClick={() => setStep(number)}
              className={clsx(
                "rounded-md py-2 text-xs font-semibold",
                step === number ? "bg-blue-600 text-white" : number < step ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              )}
            >
              {number}. {label}
            </button>
          );
        })}
      </div>

      {step === 1 && (
        <VehicleStep
          vehicle={vehicle}
          lookup={lookup}
          onChange={setVehicle}
          onNext={goNext}
        />
      )}
      {step === 2 && <OwnerStep owner={owner} onChange={setOwner} onBack={goBack} onNext={goNext} />}
      {step === 3 && (
        <ResultsStep
          fuelType={vehicle.fuelType}
          readings={detail?.readings ?? {}}
          flags={engineFlags}
          verdict={verdict}
          onChange={setEngineFlags}
          onBack={goBack}
          onNext={goNext}
        />
      )}
      {step === 4 && (
        <TechnicianStep
          technician={technician}
          onChange={setTechnician}
          onBack={goBack}
          onNext={goNext}
        />
      )}
      {step === 5 && (
        <PhotosStep
          testId={test.id}
          photos={detail?.photos ?? []}
          onBack={goBack}
          onNext={goNext}
        />
      )}
      {step === 6 && (
        <ReviewStep
          payload={payload}
          result={submitMutation.data}
          isPending={submitMutation.isPending}
          isError={submitMutation.isError}
          onBack={goBack}
          onDone={onDone}
          onSubmit={() => submitMutation.mutate()}
        />
      )}
    </div>
  );
}

function VehicleStep({ vehicle, lookup, onChange, onNext }: {
  vehicle: VehicleForm;
  lookup: VehicleLookupResponse | null;
  onChange: (vehicle: VehicleForm) => void;
  onNext: () => void;
}) {
  const set = <K extends keyof VehicleForm>(key: K, value: VehicleForm[K]) => onChange({ ...vehicle, [key]: value });
  const valid = vehicle.plateNo && vehicle.make && vehicle.series && vehicle.engineNo && vehicle.chassisNo;

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <StepHeading title="Step 1 - Plate Lookup + Vehicle Details" />
      <div className="grid grid-cols-3 gap-4">
        <TextField label="Plate No" value={vehicle.plateNo} onChange={(value) => set("plateNo", value.toUpperCase())} />
        <TextField label="MV No" value={vehicle.mvNo} onChange={(value) => set("mvNo", value)} badge={badgeFor("mvNo", vehicle.mvNo, lookup?.vehicle?.mvNo)} />
        <TextField label="Engine No" value={vehicle.engineNo} onChange={(value) => set("engineNo", value)} badge={badgeFor("engineNo", vehicle.engineNo, lookup?.vehicle?.engineNo)} />
        <TextField label="Chassis No" value={vehicle.chassisNo} onChange={(value) => set("chassisNo", value)} badge={badgeFor("chassisNo", vehicle.chassisNo, lookup?.vehicle?.chassisNo)} />
        <SelectField label="OR Type" value={vehicle.orType} options={["MVRR", "MVRS"]} onChange={(value) => set("orType", value)} badge={badgeFor("orType", vehicle.orType, lookup?.vehicle?.orType)} />
        <TextField label="CR Date" type="date" value={vehicle.crDate} onChange={(value) => set("crDate", value)} badge={badgeFor("crDate", vehicle.crDate, lookup?.vehicle?.crDate)} />
        <TextField label="CR No" value={vehicle.crNo} onChange={(value) => set("crNo", value)} badge={badgeFor("crNo", vehicle.crNo, lookup?.vehicle?.crNo)} />
        <SelectField label="District Office" value={vehicle.districtOffice} options={["1368 - PASAY CITY DISTRICT OFFICE", "1301 - QUEZON CITY DISTRICT OFFICE", "1401 - MAKATI DISTRICT OFFICE"]} onChange={(value) => set("districtOffice", value)} badge={badgeFor("districtOffice", vehicle.districtOffice, lookup?.vehicle?.districtOffice)} />
        <TextField label="Make" value={vehicle.make} onChange={(value) => set("make", value.toUpperCase())} badge={badgeFor("make", vehicle.make, lookup?.vehicle?.make)} />
        <TextField label="Series" value={vehicle.series} onChange={(value) => set("series", value.toUpperCase())} badge={badgeFor("series", vehicle.series, lookup?.vehicle?.series)} />
        <SelectField label="Vehicle Type" value={vehicle.vehicleType} options={["CAR", "MOTORCYCLE", "TRUCK", "BUS", "JEEPNEY"]} onChange={(value) => set("vehicleType", value)} badge={badgeFor("vehicleType", vehicle.vehicleType, lookup?.vehicle?.vehicleType)} />
        <TextField label="Year Model" type="number" value={String(vehicle.yearModel)} onChange={(value) => set("yearModel", Number(value || 0))} badge={badgeFor("yearModel", String(vehicle.yearModel), lookup?.vehicle ? String(lookup.vehicle.yearModel) : undefined)} />
        <TextField label="Color" value={vehicle.color} onChange={(value) => set("color", value.toUpperCase())} badge={badgeFor("color", vehicle.color, lookup?.vehicle?.color)} />
        <Segment label="Transmission" value={vehicle.transmission} options={["M/T", "A/T"]} onChange={(value) => set("transmission", value as VehicleForm["transmission"])} />
        <Segment label="Fuel Type" value={vehicle.fuelType} options={["GAS", "DIESEL", "MOTORCYCLE"]} onChange={(value) => set("fuelType", value as FuelType)} />
      </div>
      <FooterNav nextDisabled={!valid} onNext={onNext} />
    </section>
  );
}

function OwnerStep({ owner, onChange, onBack, onNext }: {
  owner: OwnerForm;
  onChange: (owner: OwnerForm) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = <K extends keyof OwnerForm>(key: K, value: OwnerForm[K]) => onChange({ ...owner, [key]: value });
  const valid = owner.ownerType === "ORGANIZATION"
    ? owner.organization && owner.address && owner.city
    : owner.lastName && owner.firstName && owner.address && owner.city;

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <StepHeading title="Step 2 - Vehicle Owner" />
      <Segment label="Owner Type" value={owner.ownerType} options={["INDIVIDUAL", "ORGANIZATION"]} onChange={(value) => set("ownerType", value as OwnerForm["ownerType"])} />
      <div className="grid grid-cols-2 gap-4">
        {owner.ownerType === "INDIVIDUAL" ? (
          <>
            <TextField label="Last Name" value={owner.lastName} onChange={(value) => set("lastName", value.toUpperCase())} />
            <TextField label="First Name" value={owner.firstName} onChange={(value) => set("firstName", value.toUpperCase())} />
            <TextField label="Middle" value={owner.middleName} onChange={(value) => set("middleName", value.toUpperCase())} />
          </>
        ) : (
          <TextField label="Organization" value={owner.organization} onChange={(value) => set("organization", value.toUpperCase())} />
        )}
        <TextField label="Address" value={owner.address} onChange={(value) => set("address", value)} />
        <TextField label="City" value={owner.city} onChange={(value) => set("city", value)} />
      </div>
      <FooterNav nextDisabled={!valid} onBack={onBack} onNext={onNext} />
    </section>
  );
}

function ResultsStep({ fuelType, readings, flags, verdict, onChange, onBack, onNext }: {
  fuelType: FuelType;
  readings: EmissionTestDetail["readings"];
  flags: EngineFlags;
  verdict: ReturnType<typeof evaluateEmission>;
  onChange: (flags: EngineFlags) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = <K extends keyof EngineFlags>(key: K, value: EngineFlags[K]) => onChange({ ...flags, [key]: value });

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <StepHeading title="Step 3 - Engine Flags + Emission Test Results" />
      <div className="grid grid-cols-3 gap-4">
        <Segment label="Turbo" value={flags.turbo} options={["TURBO", "NON_TURBO"]} onChange={(value) => set("turbo", value as EngineFlags["turbo"])} />
        <Segment label="Aspiration" value={flags.aspiration} options={["ELEVATION", "N_ASPIRATED"]} onChange={(value) => set("aspiration", value as EngineFlags["aspiration"])} />
        <Segment label="Condition" value={flags.condition} options={["REBUILT", "CONVENTIONAL"]} onChange={(value) => set("condition", value as EngineFlags["condition"])} />
      </div>
      <ReadingsGrid readings={readings} />
      <div className={clsx("rounded-md border px-4 py-3", verdict.pass ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800")}>
        <p className="font-semibold">{fuelType} verdict: {verdict.label}</p>
        {verdict.reasons.length > 0 && <p className="text-sm">{verdict.reasons.join("; ")}</p>}
      </div>
      <FooterNav onBack={onBack} onNext={onNext} />
    </section>
  );
}

function TechnicianStep({ technician, onChange, onBack, onNext }: {
  technician: TechnicianForm;
  onChange: (technician: TechnicianForm) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = <K extends keyof TechnicianForm>(key: K, value: TechnicianForm[K]) => onChange({ ...technician, [key]: value });
  const valid = technician.technicianName && technician.tesdaCertNo && technician.certificationNo;

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <StepHeading title="Step 4 - Technician / Certification" />
      <div className="grid grid-cols-3 gap-4">
        <TextField label="Technician Name" value={technician.technicianName} onChange={(value) => set("technicianName", value)} />
        <TextField label="TESDA Cert. No" value={technician.tesdaCertNo} onChange={(value) => set("tesdaCertNo", value)} />
        <TextField label="Certification No" value={technician.certificationNo} onChange={(value) => set("certificationNo", value)} />
      </div>
      <FooterNav nextDisabled={!valid} onBack={onBack} onNext={onNext} />
    </section>
  );
}

function PhotosStep({ testId, photos, onBack, onNext }: {
  testId: string;
  photos: TestPhoto[];
  onBack: () => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const captureMutation = useMutation({
    mutationFn: (photoType: PhotoType) => sidecarClient.capturePhoto({ testId, photoType }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-detail", testId] }),
  });
  const hasFront = photos.some((photo) => photo.photoType === "FRONT");
  const hasRear = photos.some((photo) => photo.photoType === "REAR");

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <StepHeading title="Step 5 - Photos" />
      <div className="grid grid-cols-2 gap-4">
        {PHOTO_TYPES.map((item) => {
          const captured = photos.filter((photo) => photo.photoType === item.type);
          return (
            <div key={item.type} className="rounded-md border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-700">{item.label}</p>
                {item.required && <span className="text-xs text-red-600">Required</span>}
              </div>
              {captured.length === 0 ? (
                <p className="text-xs text-gray-500">No photo yet.</p>
              ) : (
                <ul className="space-y-1">
                  {captured.map((photo) => (
                    <li key={photo.id} className="truncate text-xs font-mono text-gray-600">{photo.filePath}</li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => captureMutation.mutate(item.type)}
                disabled={captureMutation.isPending}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                {captureMutation.isPending ? "Capturing..." : captured.length ? "Retake / Add" : "Capture"}
              </button>
            </div>
          );
        })}
      </div>
      <FooterNav nextDisabled={!hasFront || !hasRear} onBack={onBack} onNext={onNext} />
    </section>
  );
}

function ReviewStep({ payload, result, isPending, isError, onBack, onDone, onSubmit }: {
  payload: Record<string, unknown>;
  result?: LtmsSubmitResponse;
  isPending: boolean;
  isError: boolean;
  onBack: () => void;
  onDone: () => void;
  onSubmit: () => void;
}) {
  const vehicle = payload.vehicle as VehicleForm;
  const owner = payload.owner as OwnerForm;
  const verdict = payload.verdict as ReturnType<typeof evaluateEmission>;

  if (result) {
    return (
      <section className={clsx("rounded-lg shadow p-8 text-center space-y-3", result.state === "ACCEPTED" ? "bg-green-50 border border-green-200" : result.state === "PENDING" ? "bg-yellow-50 border border-yellow-200" : "bg-red-50 border border-red-200")}>
        <p className="text-xl font-bold">{result.state === "ACCEPTED" ? "Submitted and printed" : result.state === "PENDING" ? "Queued for retry" : "Rejected"}</p>
        {result.certificateNo && <p className="text-sm text-green-700">Certificate No: <strong>{result.certificateNo}</strong></p>}
        {result.rejectionReason && <p className="text-sm text-red-700">{result.rejectionReason}</p>}
        <button onClick={onDone} className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700">Done</button>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <StepHeading title="Step 6 - Review & Submit" />
      <div className="grid grid-cols-2 gap-4 text-sm">
        <SummaryBlock title="Vehicle" rows={[
          ["Plate", vehicle.plateNo],
          ["Vehicle", `${vehicle.yearModel} ${vehicle.make} ${vehicle.series}`],
          ["Fuel", vehicle.fuelType],
          ["Engine / Chassis", `${vehicle.engineNo} / ${vehicle.chassisNo}`],
        ]} />
        <SummaryBlock title="Owner" rows={[
          ["Type", owner.ownerType],
          ["Name", owner.ownerType === "ORGANIZATION" ? owner.organization : `${owner.firstName} ${owner.middleName} ${owner.lastName}`],
          ["Address", `${owner.address}, ${owner.city}`],
        ]} />
        <SummaryBlock title="Verdict" rows={[
          ["Result", verdict.label],
          ["Reason", verdict.reasons.length ? verdict.reasons.join("; ") : "Within configured mock limits"],
        ]} />
        <SummaryBlock title="Photos" rows={[
          ["Attached", `${(payload.photos as TestPhoto[]).length}`],
        ]} />
      </div>
      {isError && <p className="text-sm text-red-600">Submission failed before it reached the sidecar.</p>}
      <div className="flex justify-between">
        <button onClick={onBack} disabled={isPending} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Back</button>
        <button onClick={onSubmit} disabled={isPending} className="rounded-md bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {isPending ? "Submitting..." : "Submit to LTMS"}
        </button>
      </div>
    </section>
  );
}

function StepHeading({ title }: { title: string }) {
  return <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">{title}</h2>;
}

function TextField({ label, value, type = "text", badge, onChange }: {
  label: string;
  value: string;
  type?: string;
  badge?: "From LTMS" | "Edited";
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-2 text-xs font-medium text-gray-600">
        {label}
        {badge && <span className={clsx("rounded-full px-1.5 py-0.5 text-[10px]", badge === "Edited" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700")}>{badge}</span>}
      </span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
    </label>
  );
}

function SelectField({ label, value, options, badge, onChange }: {
  label: string;
  value: string;
  options: string[];
  badge?: "From LTMS" | "Edited";
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-2 text-xs font-medium text-gray-600">
        {label}
        {badge && <span className={clsx("rounded-full px-1.5 py-0.5 text-[10px]", badge === "Edited" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700")}>{badge}</span>}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
        <option value="">Select...</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Segment({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-600">{label}</p>
      <div className="flex rounded-md border border-gray-300 p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={clsx("flex-1 rounded px-2 py-1.5 text-xs font-semibold", value === option ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50")}
          >
            {option.replace(/_/g, ".")}
          </button>
        ))}
      </div>
    </div>
  );
}

function FooterNav({ nextDisabled = false, onBack, onNext }: {
  nextDisabled?: boolean;
  onBack?: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex justify-between pt-2">
      {onBack ? <button onClick={onBack} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">Back</button> : <span />}
      <button onClick={onNext} disabled={nextDisabled} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Next</button>
    </div>
  );
}

function ReadingsGrid({ readings }: { readings: Record<string, number | null | undefined> }) {
  const entries = Object.entries(readings);
  return (
    <div className="grid grid-cols-4 gap-3">
      {entries.length === 0 ? (
        <p className="col-span-4 text-sm text-gray-500">No analyzer readings found for this test.</p>
      ) : entries.map(([key, value]) => (
        <div key={key} className="rounded-md border border-gray-200 px-3 py-2">
          <p className="text-[11px] uppercase text-gray-500">{key.replace(/_/g, " ")}</p>
          <p className="font-mono text-sm font-semibold text-gray-800">{value ?? "N/A"}</p>
        </div>
      ))}
    </div>
  );
}

function SummaryBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <p className="mb-2 text-xs font-bold uppercase text-gray-500">{title}</p>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-right font-medium text-gray-800">{value || "N/A"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function mapVehicle(vehicle: VehicleInfo): VehicleForm {
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

function badgeFor(_field: string, value: string, original?: string | number): "From LTMS" | "Edited" | undefined {
  if (original === undefined || original === null || original === "") return undefined;
  return String(value) === String(original) ? "From LTMS" : "Edited";
}

function lookupStatusText(lookup: VehicleLookupResponse | null, pending: boolean): string {
  if (pending) return "Looking up registry data...";
  if (!lookup) return "Mock lookup has not run yet.";
  if (!lookup.found) return "Plate not found. Complete the fields manually.";
  if (lookup.source === "LTMS_CACHE") return `From LTMS cache (${lookup.fetchedAt ? new Date(lookup.fetchedAt).toLocaleString() : "cached"})`;
  return "From LTMS mock registry.";
}
