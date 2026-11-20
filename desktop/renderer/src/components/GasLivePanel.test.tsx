import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GasLivePanel } from "./GasLivePanel";

afterEach(cleanup);

const defaultProps = {
  running: false,
  readings: null,
  photoCaptured: false,
  queuedForLtms: false,
  error: "",
  source: "Cartesykj MQ-550 / COM3",
  simulated: false,
  onStart: vi.fn(),
  onStopMachine: vi.fn(),
};

describe("GasLivePanel", () => {
  it("renders 2-column gas parameters without 6 tests or test progress", () => {
    render(<GasLivePanel {...defaultProps} />);

    // Header and badges
    expect(screen.getByText("READING")).toBeTruthy();
    expect(screen.getByText("GAS")).toBeTruthy();

    // 8 Gas parameters from mockup
    expect(screen.getAllByText("CO PCT")[0]).toBeTruthy();
    expect(screen.getAllByText("HC PPM")[0]).toBeTruthy();
    expect(screen.getByText("CO2 PCT")).toBeTruthy();
    expect(screen.getByText("O2 PCT")).toBeTruthy();
    expect(screen.getAllByText("LAMBDA VALUE")[0]).toBeTruthy();
    expect(screen.getByText("NO PPM")).toBeTruthy();
    expect(screen.getAllByText("RPM")[0]).toBeTruthy();
    expect(screen.getByText("OIL TEMP C")).toBeTruthy();
    expect(screen.getAllByText("CO PCT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HC PPM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CO2 PCT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("O2 PCT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LAMBDA VALUE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NO PPM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RPM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OIL TEMP C").length).toBeGreaterThan(0);

    // Must NOT have Diesel 6-test progress
    expect(screen.queryByText("TEST PROGRESS")).toBeNull();
    expect(screen.queryByText("/ 6")).toBeNull();
    expect(screen.queryByText("TEST 1")).toBeNull();
    expect(screen.queryByText("TEST 6")).toBeNull();
  });

  it("displays exact reading values matching mock and user screenshot", () => {
    const mockReadings = {
      co_pct: 0.12,
      hc_ppm: 85,
      co2_pct: 14.2,
      o2_pct: 0.4,
      lambda_value: 1.001,
      no_ppm: null,
      rpm: 2500,
      oil_temp_c: null,
    };

    render(
      <GasLivePanel
        {...defaultProps}
        readings={mockReadings}
        photoCaptured
        queuedForLtms
      />,
    );

    expect(screen.getAllByText("0.12")[0]).toBeTruthy();
    expect(screen.getAllByText("85")[0]).toBeTruthy();
    expect(screen.getByText("14.2")).toBeTruthy();
    expect(screen.getByText("0.4")).toBeTruthy();
    expect(screen.getAllByText("1.001")[0]).toBeTruthy();
    expect(screen.getAllByText("2500")[0]).toBeTruthy();
    expect(screen.getAllByText("0.12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("85").length).toBeGreaterThan(0);
    expect(screen.getAllByText("14.2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2500").length).toBeGreaterThan(0);

    // Status notes from screenshot
    expect(screen.getByText("Photo captured")).toBeTruthy();
    expect(
      screen.getByText(/Test queued for LTMS upload/i),
    ).toBeTruthy();
  });

  it("calls onStopMachine when Stop Machine button is clicked while running", () => {
    const stopMachineSpy = vi.fn();
    render(
      <GasLivePanel
        {...defaultProps}
        running
        onStopMachine={stopMachineSpy}
      />,
    );

    expect(screen.getByText("SAMPLING")).toBeTruthy();
    const stopBtn = screen.getByRole("button", { name: /stop machine/i });
    expect(stopBtn).toBeTruthy();

    fireEvent.click(stopBtn);
    expect(stopMachineSpy).toHaveBeenCalledOnce();
  });
});

