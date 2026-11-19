import axios from "axios";
import { create } from "zustand";

export type BackendFailureKind = "forbidden" | "unreachable";

export interface BackendFailure {
  kind: BackendFailureKind;
  status?: number;
}

interface BackendAvailabilityState {
  failure: BackendFailure | null;
  reportFailure: (failure: BackendFailure) => void;
  clearFailure: () => void;
}

export const useBackendAvailabilityStore = create<BackendAvailabilityState>((set) => ({
  failure: null,
  reportFailure: (failure) => set({ failure }),
  clearFailure: () => set({ failure: null }),
}));

/**
 * Return a user-actionable backend failure for requests that must fail fast.
 * The dev proxy reports an unreachable Spring process as a 5xx response, while
 * a direct deployment can surface the same condition as a network error.
 */
export function classifyBackendFailure(error: unknown): BackendFailure | null {
  if (!axios.isAxiosError(error) || axios.isCancel(error)) return null;

  const status = error.response?.status;
  if (status === 403) return { kind: "forbidden", status };
  if (status === undefined || status >= 500) return { kind: "unreachable", status };
  return null;
}

export function reportBackendFailure(error: unknown): boolean {
  const failure = classifyBackendFailure(error);
  if (!failure) return false;
  useBackendAvailabilityStore.getState().reportFailure(failure);
  return true;
}

export function isBackendUnavailableError(error: unknown): boolean {
  return classifyBackendFailure(error) !== null;
}
