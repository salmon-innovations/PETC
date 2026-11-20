import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import {
  CloudArrowUp,
  CheckCircle,
  XCircle,
  ArrowLeft,
  ArrowRight,
  Camera,
  MagnifyingGlass,
  Car,
  Printer,
  WarningCircle,
  Check,
} from "@phosphor-icons/react";
import { isLtmsNonterminalState, isLtmsSuccessState, sidecarClient, type LtmsSubmitResponse, type VehicleLookupResponse } from "../../api/sidecarClient";
import { useAuthStore } from "../../store/authStore";
import { INSPECTION_PURPOSE_LABELS, type Classification, type DotrVehicleGroup, type EmissionTest, type EmissionTestDetail, type FuelType, type InspectionPurpose, type OwnerInfo, type TestPhoto, type VehicleInfo } from "../../types";
import { evaluateEmission, type EngineFlags } from "../../utils/emissionLimits";
import { CameraStream, type CameraStreamHandle } from "../../components/CameraStream";
import { TestListFilters } from "../../components/TestListFilters";
import { useSearchParams } from "react-router-dom";
import { EMPTY_TEST_FILTERS, filterEmissionTests, type TestListFilterState } from "../../utils/testFilters";
import { triggerAlert } from "../../store/alertStore";

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
  classification: Classification;
  dotrVehicleGroup: DotrVehicleGroup;
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
  classification: "PRIVATE",
  dotrVehicleGroup: "LIGHT",
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

const STEP_LABELS = ["Vehicle", "Owner", "Results", "Technician", "Photos", "Review"] as const;

export default function LtmsUploadPage() {
  const [selected, setSelected] = useState<EmissionTest | null>(null);
  const [filters, setFilters] = useState<TestListFilterState>({ ...EMPTY_TEST_FILTERS });
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTestId = searchParams.get("testId");

  const { data: pending = [], isLoading } = useQuery<EmissionTest[]>({
    queryKey: ["tests", "pending-ltms"],
    queryFn: async () => {
      const base = await window.petcBridge.getSidecarUrl();
      const response = await fetch(`${base}/tests?ltms_state=PENDING`);
      if (!response.ok) throw new Error("Unable to load pending tests");
      return response.json();
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (selected || !requestedTestId) return;
    const requestedTest = pending.find((test) => test.id === requestedTestId);
    if (requestedTest) setSelected(requestedTest);
  }, [pending, requestedTestId, selected]);

  const closeWizard = () => {
    setSelected(null);
    if (requestedTestId) setSearchParams({}, { replace: true });
  };

  const openWizard = (test: EmissionTest) => {
    setSelected(test);
    setSearchParams({ testId: test.id }, { replace: true });
  };

  const filteredPending = useMemo(
    () => filterEmissionTests(pending, filters),
    [pending, filters],
  );

  if (selected) {
    return <UploadWizard test={selected} onDone={closeWizard} onCancel={closeWizard} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="max-w-5xl mx-auto p-6 md:p-8 space-y-6 text-slate-800"
    >
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-sm flex-shrink-0">
          <CloudArrowUp size={28} weight="fill" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">LTMS Upload Queue</h1>
          <p className="text-sm text-slate-500 font-medium">Completed local emission tests queued for official registry submission.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
        <TestListFilters filters={filters} onChange={setFilters} />
      </div>

      {pending.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm font-semibold text-slate-600">
            Showing <span className="text-blue-600 font-bold">{filteredPending.length}</span> of {pending.length} pending submissions
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-pulse"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-28 bg-slate-200 rounded-lg" />
                  <div className="h-6 w-16 bg-slate-100 rounded-md" />
                </div>
                <div className="h-4 w-52 bg-slate-100 rounded-md" />
              </div>
              <div className="flex items-center gap-3">
                <div className="h-7 w-20 bg-slate-100 rounded-full" />
                <div className="h-10 w-32 bg-slate-200 rounded-2xl" />
              </div>
            </div>
          ))}
        </div>
      ) : pending.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mx-auto mb-3 shadow-inner">
            <CheckCircle size={32} weight="fill" />
          </div>
          <p className="text-base font-bold text-slate-800">All Tests Submitted</p>
          <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">There are no pending tests awaiting LTMS registry upload.</p>
        </div>
      ) : filteredPending.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3 shadow-inner">
            <Car size={32} />
          </div>
          <p className="text-base font-bold text-slate-800">No Matching Pending Tests</p>
          <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">Try clearing or adjusting your search filters above.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {filteredPending.map((test) => (
            <div key={test.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50/80 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="font-extrabold text-lg text-slate-900 tracking-wide font-mono bg-slate-100 px-3 py-0.5 rounded-lg border border-slate-200">
                    {test.plateNumber}
                  </span>
                  <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 uppercase">
                    {test.fuelType}
                  </span>
                </div>
                <p className="text-sm text-slate-600 font-medium">
                  {INSPECTION_PURPOSE_LABELS[test.inspectionPurpose]} · {test.startedAt ? new Date(test.startedAt).toLocaleString() : "No date"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={clsx(
                  "rounded-full px-3 py-1 text-xs font-extrabold flex items-center gap-1.5 border shadow-xs",
                  test.passFail
                    ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                    : "bg-red-50 text-red-700 border-red-300"
                )}>
                  {test.passFail ? (
                    <>
                      <CheckCircle size={15} weight="fill" />
                      PASS
                    </>
                  ) : (
                    <>
                      <XCircle size={15} weight="fill" />
                      FAIL
                    </>
                  )}
                </span>
                <button
                  onClick={() => openWizard(test)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-all shadow-sm cursor-pointer min-h-[42px]"
                >
                  <span>Open Wizard</span>
                  <ArrowRight size={16} weight="bold" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function UploadWizard({ test, onDone, onCancel }: { test: EmissionTest; onDone: () => void; onCancel: () => void }) {
  const requiresManualEntry = test.inspectionPurpose === "FOR_INIT_REG";
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
      if (result.vehicle) {
        setVehicle((current) => mapVehicle(result.vehicle!, current.fuelType));
      }
      if (result.owner) setOwner(result.owner);
    },
  });

  useEffect(() => {
    if (requiresManualEntry) {
      setLookup({ found: false, source: "LTMS", vehicle: null, owner: null });
      return;
    }
    lookupMutation.mutate(test.plateNumber);
  }, [requiresManualEntry, test.plateNumber]);

  const verdict = useMemo(
    () => evaluateEmission(vehicle.fuelType, detail?.readings ?? {}, engineFlags),
    [detail?.readings, engineFlags, vehicle.fuelType],
  );

  const payload = useMemo(() => ({
    centerName: "PETC Center",
    testId: test.id,
    testDatetime: detail?.testedAt ?? test.completedAt ?? test.startedAt,
    inspection: { purpose: test.inspectionPurpose },
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
    onSuccess: (res) => {
      triggerAlert.success("LTMS Submission Sent", `Test record for ${test.plateNumber} transmitted to LTMS (${res.state})`);
      qc.invalidateQueries({ queryKey: ["tests", "pending-ltms"] });
      qc.invalidateQueries({ queryKey: ["test-detail", test.id] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to transmit test record";
      triggerAlert.error("LTMS Upload Failed", msg);
    },
  });

  const goNext = () => setStep((current) => Math.min(6, current + 1) as WizardStep);
  const goBack = () => setStep((current) => Math.max(1, current - 1) as WizardStep);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="max-w-5xl mx-auto p-6 md:p-8 space-y-6 text-slate-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-3.5">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs min-h-[42px]"
          >
            <ArrowLeft size={18} weight="bold" />
            <span>Back to Queue</span>
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">LTMS Upload</h1>
              <span className="font-mono font-extrabold text-base bg-blue-50 text-blue-800 border border-blue-200 px-3 py-0.5 rounded-lg">
                {test.plateNumber}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {INSPECTION_PURPOSE_LABELS[test.inspectionPurpose]} · {requiresManualEntry
                ? "New registration: manual encoding required."
                : lookupStatusText(lookup, lookupMutation.isPending)}
            </p>
          </div>
        </div>

        {requiresManualEntry ? (
          <span className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2 text-xs font-bold text-amber-800">
            Manual Encoding Mode
          </span>
        ) : (
          <button
            onClick={() => lookupMutation.mutate(vehicle.plateNo)}
            disabled={lookupMutation.isPending}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-xs cursor-pointer min-h-[42px]"
          >
            <MagnifyingGlass size={16} weight="bold" />
            <span>{lookupMutation.isPending ? "Looking up…" : "Re-query Registry"}</span>
          </button>
        )}
      </div>

      {/* Step Indicator Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 bg-slate-100/80 p-2 rounded-2xl border border-slate-200">
        {STEP_LABELS.map((label, index) => {
          const number = (index + 1) as WizardStep;
          const isActive = step === number;
          const isDone = number < step;

          return (
            <button
              key={label}
              onClick={() => setStep(number)}
              className={clsx(
                "flex items-center justify-center gap-1.5 rounded-xl py-2.5 px-3 text-xs font-bold transition-all min-h-[40px] cursor-pointer",
                isActive
                  ? "bg-blue-600 text-white shadow-md"
                  : isDone
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200/60"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              )}
            >
              {isDone && <Check size={14} weight="bold" />}
              <span>{number}. {label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.2 }}
        >
          {step === 1 && (
            <VehicleStep
              vehicle={vehicle}
              lookup={lookup}
              requiresManualEntry={requiresManualEntry}
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
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function VehicleStep({ vehicle, lookup, requiresManualEntry, onChange, onNext }: {
  vehicle: VehicleForm;
  lookup: VehicleLookupResponse | null;
  requiresManualEntry: boolean;
  onChange: (vehicle: VehicleForm) => void;
  onNext: () => void;
}) {
  const set = <K extends keyof VehicleForm>(key: K, value: VehicleForm[K]) => onChange({ ...vehicle, [key]: value });
  const valid = vehicle.mvNo && vehicle.make && vehicle.series && vehicle.engineNo && vehicle.chassisNo
    && (requiresManualEntry || vehicle.plateNo);

  return (
    <section className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-7 space-y-6">
      <StepHeading title={requiresManualEntry ? "Step 1 - Manual Vehicle Encoding" : "Step 1 - Plate Verification & Vehicle Specs"} />
      {requiresManualEntry && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 font-medium leading-relaxed">
          <WarningCircle size={20} weight="fill" className="text-amber-600 flex-shrink-0 mt-0.5" />
          <span>Initial registration is treated as not yet available in LTMS or Stradcom. Encode the vehicle details manually. The fuel type remains as tested.</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        <TextField label="Plate No" value={vehicle.plateNo} onChange={(value) => set("plateNo", value.toUpperCase())} />
        <TextField label="MV File No" value={vehicle.mvNo} onChange={(value) => set("mvNo", value)} badge={badgeFor("mvNo", vehicle.mvNo, lookup?.vehicle?.mvNo)} />
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
        <Segment label="Fuel Type" value={vehicle.fuelType} options={["GAS", "DIESEL"]} onChange={(value) => set("fuelType", value as FuelType)} />
        <Segment label="DOTr Vehicle Group" value={vehicle.dotrVehicleGroup} options={["LIGHT", "HEAVY", "MOTORCYCLE"]} onChange={(value) => {
          const group = value as DotrVehicleGroup;
          onChange({ ...vehicle, dotrVehicleGroup: group, fuelType: group === "MOTORCYCLE" ? "GAS" : vehicle.fuelType });
        }} />
        <Segment label="Classification" value={vehicle.classification} options={["PRIVATE", "FOR_HIRE", "GOVERNMENT", "EXEMPT", "DIPLOMATIC"]} onChange={(value) => set("classification", value as Classification)} />
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
    <section className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-7 space-y-6">
      <StepHeading title="Step 2 - Registered Vehicle Owner" />
      <Segment label="Owner Type" value={owner.ownerType} options={["INDIVIDUAL", "ORGANIZATION"]} onChange={(value) => set("ownerType", value as OwnerForm["ownerType"])} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {owner.ownerType === "INDIVIDUAL" ? (
          <>
            <TextField label="Last Name" value={owner.lastName} onChange={(value) => set("lastName", value.toUpperCase())} />
            <TextField label="First Name" value={owner.firstName} onChange={(value) => set("firstName", value.toUpperCase())} />
            <TextField label="Middle Name" value={owner.middleName} onChange={(value) => set("middleName", value.toUpperCase())} />
          </>
        ) : (
          <TextField label="Organization / Entity Name" value={owner.organization} onChange={(value) => set("organization", value.toUpperCase())} />
        )}
        <TextField label="Street Address" value={owner.address} onChange={(value) => set("address", value)} />
        <TextField label="City / Municipality" value={owner.city} onChange={(value) => set("city", value)} />
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
    <section className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-7 space-y-6">
      <StepHeading title="Step 3 - Engine Flags & Emission Test Results" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Segment label="Turbo Setup" value={flags.turbo} options={["TURBO", "NON_TURBO"]} onChange={(value) => set("turbo", value as EngineFlags["turbo"])} />
        <Segment label="Aspiration" value={flags.aspiration} options={["ELEVATION", "N_ASPIRATED"]} onChange={(value) => set("aspiration", value as EngineFlags["aspiration"])} />
        <Segment label="Condition" value={flags.condition} options={["REBUILT", "CONVENTIONAL"]} onChange={(value) => set("condition", value as EngineFlags["condition"])} />
      </div>
      <ReadingsGrid readings={readings} />
      <div className={clsx("rounded-2xl border px-5 py-4", verdict.pass ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-red-50 border-red-200 text-red-900")}>
        <div className="flex items-center gap-2">
          {verdict.pass ? <CheckCircle size={20} weight="fill" className="text-emerald-600" /> : <XCircle size={20} weight="fill" className="text-red-600" />}
          <p className="font-extrabold text-base">{fuelType} Verdict: {verdict.label}</p>
        </div>
        {verdict.reasons.length > 0 && <p className="text-sm mt-1 font-medium text-slate-700">{verdict.reasons.join("; ")}</p>}
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
    <section className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-7 space-y-6">
      <StepHeading title="Step 4 - Authorized Testing Technician" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <TextField label="Technician Name" value={technician.technicianName} onChange={(value) => set("technicianName", value)} />
        <TextField label="TESDA Cert. No" value={technician.tesdaCertNo} onChange={(value) => set("tesdaCertNo", value)} />
        <TextField label="Center Cert. No" value={technician.certificationNo} onChange={(value) => set("certificationNo", value)} />
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
  const cameraRef = useRef<CameraStreamHandle>(null);
  const [status, setStatus] = useState<string | null>(null);

  const captureMutation = useMutation({
    mutationFn: async (photoType: PhotoType) => {
      const blob = await cameraRef.current?.captureBlob();
      if (!blob) throw new Error("Camera preview not ready");
      return sidecarClient.uploadTestPhoto({ testId, blob, photoType });
    },
    onSuccess: () => {
      setStatus("Photo saved ✓");
      triggerAlert.success("Photo Uploaded", "Vehicle photo saved and linked to test");
      qc.invalidateQueries({ queryKey: ["test-detail", testId] });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Upload error";
      setStatus(`Failed: ${msg}`);
      triggerAlert.error("Photo Upload Error", msg);
    },
  });

  const hasFront = photos.some((photo) => photo.photoType === "FRONT");

  return (
    <section className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-7 space-y-6">
      <StepHeading title="Step 5 - Vehicle Verification Photos" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
            <CameraStream ref={cameraRef} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => captureMutation.mutate("FRONT")}
              disabled={captureMutation.isPending}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 text-white px-5 py-3 text-sm font-bold hover:bg-blue-700 disabled:opacity-50 min-h-[44px] shadow-sm cursor-pointer"
            >
              <Camera size={18} weight="bold" />
              <span>{captureMutation.isPending ? "Capturing…" : hasFront ? "Retake Vehicle Photo" : "Capture Photo"}</span>
            </button>
            {status && (
              <span className={clsx("text-xs font-bold", status.startsWith("Failed") ? "text-red-600" : "text-emerald-700")}>
                {status}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-bold text-slate-800">Attached Verification Photos</p>
          {photos.filter((p) => p.photoType === "FRONT").length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <Camera size={32} className="text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-600">No vehicle photo recorded</p>
              <p className="text-xs text-slate-400 mt-0.5">Use the live camera preview to snap the vehicle rear and license plate.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {photos.filter((p) => p.photoType === "FRONT").map((photo) => (
                <PhotoThumb key={photo.id} photoId={photo.id} />
              ))}
            </div>
          )}
        </div>
      </div>

      <FooterNav nextDisabled={!hasFront} onBack={onBack} onNext={onNext} />
    </section>
  );
}

function PhotoThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    sidecarClient.photoUrl(photoId).then((u) => { if (!cancelled) setSrc(u); });
    return () => { cancelled = true; };
  }, [photoId]);
  return (
    <div className="aspect-square rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden shadow-xs">
      {src ? (
        <img src={src} alt="Captured photo" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">Loading…</div>
      )}
    </div>
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
  const purpose = (payload.inspection as { purpose: InspectionPurpose }).purpose;

  if (result) {
    if (isLtmsSuccessState(result.state) && result.submissionId) {
      return <CecPreviewAndPrint submissionId={result.submissionId} certificateNo={result.certificateNo} onDone={onDone} />;
    }
    if (isLtmsNonterminalState(result.state)) {
      return (
        <section className="rounded-3xl shadow-md p-8 text-center space-y-4 bg-blue-50 border border-blue-200">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 mx-auto shadow-inner">
            <CloudArrowUp size={32} weight="fill" />
          </div>
          <p className="text-xl font-black text-blue-900">{result.state} — Awaiting LTMS Registry</p>
          <p className="text-sm text-blue-700 max-w-md mx-auto leading-relaxed">
            The test has been transmitted to cloud sync. LTMS is validating the transaction.
            The official CEC certificate will appear automatically in <strong>Test History</strong> once confirmed.
          </p>
          <button onClick={onDone} className="rounded-2xl bg-blue-600 px-8 py-3 text-sm font-bold text-white hover:bg-blue-700 min-h-[44px] cursor-pointer shadow-md">
            Go to Test History
          </button>
        </section>
      );
    }
    return (
      <section className="rounded-3xl shadow-md p-8 text-center space-y-4 bg-red-50 border border-red-200">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 mx-auto shadow-inner">
          <WarningCircle size={32} weight="fill" />
        </div>
        <p className="text-xl font-black text-red-900">{result.state.replaceAll("_", " ")}</p>
        {result.rejectionReason && <p className="text-sm text-red-700 max-w-md mx-auto">{result.rejectionReason}</p>}
        <button onClick={onDone} className="rounded-2xl bg-blue-600 px-8 py-3 text-sm font-bold text-white hover:bg-blue-700 min-h-[44px] cursor-pointer shadow-md">
          Return to Queue
        </button>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-7 space-y-6">
      <StepHeading title="Step 6 - Review Summary & Confirm Transmission" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
        <SummaryBlock title="Vehicle Specifications" rows={[
          ["Purpose", INSPECTION_PURPOSE_LABELS[purpose]],
          ["Plate No", vehicle.plateNo],
          ["Vehicle", `${vehicle.yearModel} ${vehicle.make} ${vehicle.series}`],
          ["Fuel Type", vehicle.fuelType],
          ["DOTr Group", vehicle.dotrVehicleGroup],
          ["Classification", vehicle.classification],
          ["Engine / Chassis", `${vehicle.engineNo} / ${vehicle.chassisNo}`],
        ]} />
        <SummaryBlock title="Owner Information" rows={[
          ["Type", owner.ownerType],
          ["Name", owner.ownerType === "ORGANIZATION" ? owner.organization : `${owner.firstName} ${owner.middleName} ${owner.lastName}`],
          ["Address", `${owner.address}, ${owner.city}`],
        ]} />
        <SummaryBlock title="Inspection Result" rows={[
          ["Overall Verdict", verdict.label],
          ["Evaluation Basis", verdict.reasons.length ? verdict.reasons.join("; ") : "Within regulatory emission thresholds"],
        ]} />
        <SummaryBlock title="Attached Media" rows={[
          ["Photos Attached", `${(payload.photos as TestPhoto[]).length} file(s)`],
        ]} />
      </div>
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Submission failed before it reached the sidecar service. Verify connection in Settings.
        </div>
      )}
      <div className="flex justify-between items-center pt-2">
        <button
          onClick={onBack}
          disabled={isPending}
          className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 min-h-[44px] cursor-pointer"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-8 py-3 text-base font-black text-white hover:bg-emerald-500 disabled:opacity-50 min-h-[48px] shadow-lg cursor-pointer"
        >
          <CloudArrowUp size={20} weight="fill" />
          <span>{isPending ? "Transmitting…" : "Transmit to LTMS"}</span>
        </button>
      </div>
    </section>
  );
}

function CecPreviewAndPrint({ submissionId, certificateNo, onDone }: {
  submissionId: string;
  certificateNo: string | null;
  onDone: () => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [printStatus, setPrintStatus] = useState<"idle" | "printed" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    sidecarClient.cecPdfUrl(submissionId).then((url) => {
      if (!cancelled) setPdfUrl(url);
    });
    return () => { cancelled = true; };
  }, [submissionId]);

  const printMutation = useMutation({
    mutationFn: () => sidecarClient.printCec(submissionId, 2),
    onSuccess: () => setPrintStatus("printed"),
    onError: () => setPrintStatus("error"),
  });

  return (
    <section className="bg-white rounded-3xl border border-slate-200/90 shadow-md overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-200 bg-emerald-50 px-6 py-4">
        <div>
          <p className="text-base font-black text-emerald-900">Certificate of Emission Compliance Issued</p>
          {certificateNo && (
            <p className="text-xs text-emerald-700 font-bold">Certificate No: {certificateNo}</p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {printStatus === "printed" && <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-md">Sent to printer ✓</span>}
          {printStatus === "error" && <span className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1 rounded-md">Print failed</span>}
          <button
            onClick={() => printMutation.mutate()}
            disabled={printMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 min-h-[40px] cursor-pointer shadow-sm"
          >
            <Printer size={16} weight="bold" />
            <span>{printMutation.isPending ? "Printing…" : "Print CEC ×2"}</span>
          </button>
          <button
            onClick={onDone}
            className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[40px] cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
      <div className="h-[70vh] bg-slate-100">
        {pdfUrl ? (
          <iframe src={pdfUrl} title="CEC preview" className="w-full h-full border-0" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">Loading Certificate PDF…</div>
        )}
      </div>
    </section>
  );
}

function StepHeading({ title }: { title: string }) {
  return <h2 className="text-base font-black tracking-tight text-slate-900">{title}</h2>;
}

function TextField({ label, value, type = "text", badge, onChange }: {
  label: string;
  value: string;
  type?: string;
  badge?: "From LTMS" | "Edited";
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-sm font-bold text-slate-700">
        <span>{label}</span>
        {badge && (
          <span className={clsx(
            "rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase",
            badge === "Edited" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
          )}>
            {badge}
          </span>
        )}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[46px] shadow-xs"
      />
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
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-sm font-bold text-slate-700">
        <span>{label}</span>
        {badge && (
          <span className={clsx(
            "rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase",
            badge === "Edited" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
          )}>
            {badge}
          </span>
        )}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[46px] shadow-xs"
      >
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
    <div className="space-y-1.5">
      <p className="text-sm font-bold text-slate-700">{label}</p>
      <div className="flex rounded-xl border border-slate-300 bg-slate-100/70 p-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={clsx(
              "flex-1 rounded-lg px-2.5 py-2 text-xs font-extrabold transition-all cursor-pointer",
              value === option ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
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
    <div className="flex justify-between items-center pt-3 border-t border-slate-100">
      {onBack ? (
        <button
          onClick={onBack}
          className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 min-h-[44px] cursor-pointer"
        >
          Back
        </button>
      ) : <span />}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-8 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 min-h-[44px] shadow-sm cursor-pointer"
      >
        <span>Continue</span>
        <ArrowRight size={16} weight="bold" />
      </button>
    </div>
  );
}

function ReadingsGrid({ readings }: { readings: Record<string, number | null | undefined> }) {
  const entries = Object.entries(readings);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {entries.length === 0 ? (
        <p className="col-span-4 text-sm text-slate-500 font-medium">No analyzer readings found for this test.</p>
      ) : entries.map(([key, value]) => (
        <div key={key} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{key.replace(/_/g, " ")}</p>
          <p className="font-mono text-base font-black text-slate-800 mt-0.5">{value ?? "N/A"}</p>
        </div>
      ))}
    </div>
  );
}

function SummaryBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
      <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">{title}</p>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <dt className="text-slate-500 font-medium">{label}</dt>
            <dd className="text-right font-bold text-slate-800">{value || "N/A"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function mapVehicle(vehicle: VehicleInfo, fallbackFuelType: FuelType): VehicleForm {
  const motorcycle = vehicle.vehicleType === "MOTORCYCLE" || vehicle.fuelType === "MOTORCYCLE";
  const fuelType = motorcycle ? "GAS" : vehicle.fuelType ?? fallbackFuelType;
  const dotrVehicleGroup = vehicle.dotrVehicleGroup
    ?? (motorcycle ? "MOTORCYCLE" : ["TRUCK", "BUS"].includes(vehicle.vehicleType) ? "HEAVY" : "LIGHT");
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
    fuelType,
    classification: vehicle.classification === "PUBLIC"
      ? "FOR_HIRE"
      : vehicle.classification ?? "PRIVATE",
    dotrVehicleGroup,
  };
}

function badgeFor(_field: string, value: string, original?: string | number): "From LTMS" | "Edited" | undefined {
  if (original === undefined || original === null || original === "") return undefined;
  return String(value) === String(original) ? "From LTMS" : "Edited";
}

function lookupStatusText(lookup: VehicleLookupResponse | null, pending: boolean): string {
  if (pending) return "Querying registry database…";
  if (!lookup) return "Lookup pending.";
  if (!lookup.found) return "Record not found in registry. Encode fields manually.";
  if (lookup.source === "LTMS_CACHE") return `Loaded from cache (${lookup.fetchedAt ? new Date(lookup.fetchedAt).toLocaleString() : "cached"})`;
  return "Loaded from LTMS registry.";
}
