export type FuelType = "GAS" | "DIESEL" | "MOTORCYCLE";
export type Role = "operator" | "cashier" | "manager" | "tenant_admin";

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
  photoCount: number;
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
}
