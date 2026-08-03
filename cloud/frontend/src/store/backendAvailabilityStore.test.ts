import type { AxiosError } from "axios";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyBackendFailure,
  useBackendAvailabilityStore,
} from "./backendAvailabilityStore";

function axiosError(status?: number): AxiosError {
  return {
    isAxiosError: true,
    name: "AxiosError",
    message: "request failed",
    toJSON: () => ({}),
    response: status === undefined ? undefined : { status },
  } as AxiosError;
}

describe("classifyBackendFailure", () => {
  afterEach(() => useBackendAvailabilityStore.getState().clearFailure());

  it("classifies forbidden responses as fail-fast backend failures", () => {
    expect(classifyBackendFailure(axiosError(403))).toEqual({
      kind: "forbidden",
      status: 403,
    });
  });

  it("classifies network and server failures as unreachable", () => {
    expect(classifyBackendFailure(axiosError())).toEqual({
      kind: "unreachable",
      status: undefined,
    });
    expect(classifyBackendFailure(axiosError(503))).toEqual({
      kind: "unreachable",
      status: 503,
    });
  });

  it("does not classify ordinary client errors as backend outages", () => {
    expect(classifyBackendFailure(axiosError(400))).toBeNull();
    expect(classifyBackendFailure(new Error("not axios"))).toBeNull();
  });
});
