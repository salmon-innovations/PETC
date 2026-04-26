export type FuelType = "GAS" | "DIESEL";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  tenantId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
