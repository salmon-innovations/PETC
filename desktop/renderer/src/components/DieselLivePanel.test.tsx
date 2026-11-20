import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DieselLivePanel } from "./DieselLivePanel";
import type { CaptureSequence } from "../api/sidecarClient";

afterEach(cleanup);
const props = { running: false, awaitingResult: false, error: "", simulated: false, source: "MQY-200 / COM3", onAccept: vi.fn(), onCancel: vi.fn() };
const progress: CaptureSequence = { state: "running", message: "Accelerate pedal", cycle: 2, countdown: 8, current_k: 1.23, sample_count: 10, invalid_count: 1, peaks: [1.5], average: null, cycles: [{ cycle: 1, samples: [1.5], responses: [], peak: 1.5 }] };

describe("diesel live display", () => {
  it("shows all six slots before starting and labels mock data", () => {
    render(<DieselLivePanel {...props} progress={null} simulated />);
    expect(screen.getByText("SIMULATION")).toBeTruthy();
    for (let i = 1; i <= 6; i++) expect(screen.getByText(`TEST ${i}`)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Get Test Result" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("updates K, countdown and completed tests from progress", () => {
    const { rerender } = render(<DieselLivePanel {...props} running progress={progress} />);
    expect(screen.getByText("1.23")).toBeTruthy();
    expect(screen.getByText("08")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Accelerate pedal");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    rerender(<DieselLivePanel {...props} running progress={{ ...progress, current_k: 1.87, countdown: 5, message: "Release pedal" }} />);
    expect(screen.getByText("1.87")).toBeTruthy();
    expect(screen.getByText("05")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Release pedal");
  });
  it("enables explicit acceptance only after six cycles", () => {
    const accept = vi.fn();
    render(<DieselLivePanel {...props} onAccept={accept} running awaitingResult progress={{ ...progress, state: "complete", cycle: 6, peaks: [1, 2, 3, 4, 5, 6], current_k: null, countdown: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Get Test Result" }));
    expect(accept).toHaveBeenCalledOnce();
    expect(screen.getByText("TOTAL AVERAGE K")).toBeTruthy();
    expect(screen.queryByText("3.50")).toBeNull();
  });
});
