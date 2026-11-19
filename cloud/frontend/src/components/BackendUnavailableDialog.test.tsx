import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBackendAvailabilityStore } from "../store/backendAvailabilityStore";
import BackendUnavailableDialog from "./BackendUnavailableDialog";

describe("BackendUnavailableDialog", () => {
  afterEach(() => {
    cleanup();
    useBackendAvailabilityStore.getState().clearFailure();
  });

  it("blocks the UI with a retry action when the backend is unreachable", () => {
    useBackendAvailabilityStore.getState().reportFailure({ kind: "unreachable" });
    render(<BackendUnavailableDialog />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Cloud backend unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();
  });

  it("offers a fresh sign-in when the backend returns forbidden", () => {
    useBackendAvailabilityStore.getState().reportFailure({ kind: "forbidden", status: 403 });
    render(<BackendUnavailableDialog />);

    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });
});
