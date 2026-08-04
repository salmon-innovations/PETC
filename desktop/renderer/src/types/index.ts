export type FuelType = "GAS" | "DIESEL" | "MOTORCYCLE";
export type Role = "operator" | "cashier" | "manager" | "tenant_admin";
export type Classification = "PRIVATE" | "PUBLIC" | "GOVERNMENT" | "DIPLOMATIC";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  tesdaCertNo?: string;
  certificationNo?: string;
}

export interface VehicleInfo {
  plateNo: string;
  plateNumber: string;
  mvNo: string;
  make: string;
  series: string;
  model: string;
  vehicleType: string;
  yearModel: number;
  year: number;
  color: string;
  transmission: "M/T" | "A/T";
  fuelType: FuelType;
  engineNo: string;
  chassisNo: string;
  orType: string;
  crDate: string;
  crNo: string;
  districtOffice: string;
  ownerName: string;
  // Optional: the registry does not always return it, so the wizard defaults
  // to PRIVATE. It is printed on the CEC (see sidecar cec/pdf.py).
  classification?: Classification;
}

export interface OwnerInfo {
  ownerType: "INDIVIDUAL" | "ORGANIZATION";
  lastName: string;
  firstName: string;
  middleName: string;
  organization: string;
  address: string;
  city: string;
}

export interface DriverInfo {
  licenseNo: string;
  fullName: string;
  licenseType: string;
  expiryDate: string;
}

export interface GasReadings {
  co_pct: number;
  hc_ppm: number;
  co2_pct: number;
  o2_pct: number;
  lambda_value: number;
  rpm?: number;
  oil_temp_c?: number;
}

export interface DieselReadings {
  opacity_pct: number;
  k_value: number;
  rpm?: number;
  boost_kpa?: number;
}

export interface EmissionTest {
  id: string;
  plateNumber: string;
  fuelType: FuelType;
  passFail: boolean | null;
  startedAt: string | null;
  completedAt: string | null;
  ltmsState: string | null;
  certificateNo: string | null;
  submissionId: string | null;
  photoCount: number;
  centerId?: string | null;
  laneId?: string | null;
  laneNumber?: number | null;
}

export interface TestPhoto {
  id: string;
  testId: string;
  photoType: "FRONT" | "REAR" | "RESULT" | "OTHER";
  mimeType: string;
  filePath: string;
  capturedAt: string;
  cameraId: string | null;
}

export interface EmissionTestDetail extends EmissionTest {
  testedAt: string | null;
  readings: Record<string, number | null>;
  photos: TestPhoto[];
}

export interface SidecarStatus {
  analyzerConnected: boolean;
  printerStatus: { online: boolean; paper_ok: boolean };
  cloudOutboxPending: number;
  agentVersion: string;
  /** null until the cloud answers; stays null in local-mock mode. */
  walletBalanceCentavos: number | null;
  walletLow: boolean;
  walletNegative: boolean;
  /** Submissions the cloud is holding because the wallet cannot cover them. */
  walletBlockedCount: number;
  /** ISO timestamp of the last successful wallet read, for staleness display. */
  walletFetchedAt: string | null;
  walletCenterId: string | null;
  /** Last cloud-registered price; display only, never a local upload gate. */
  walletChargePerUploadCentavos: number | null;
  walletLowBalanceThresholdCentavos: number | null;
  walletPricingUpdatedAt: string | null;
  /** Authenticated installation identity; absent until a lane-aware cloud responds. */
  centerId: string | null;
  centerName: string | null;
  laneId: string | null;
  laneNumber: number | null;
  laneActive: boolean | null;
  laneIdentityConflict: boolean;
  /** Accepted CECs today (not including active reservations). */
  laneQuotaUsed: number | null;
  /** In-progress cloud reservations already holding lane capacity. */
  laneQuotaReserved: number | null;
  laneQuotaLimit: number | null;
  /** Capacity after accepted CECs and reservations; this gates a new test. */
  laneQuotaRemaining: number | null;
  laneQuotaBusinessDate: string | null;
  laneQuotaResetsAt: string | null;
  laneQuotaFetchedAt: string | null;
  configured: boolean;
  commissioningRequired: boolean;
  config: {
    profile?: string;
    cloudUrl?: string;
    expectedCenter?: string;
    expectedLane?: string;
    keyConfigured?: boolean;
    keyMasked?: string;
  };
  readinessReady: boolean;
  readinessReason: string;
}
