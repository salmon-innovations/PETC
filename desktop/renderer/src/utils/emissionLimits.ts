import type { FuelType } from "../types";

export interface EmissionVerdict {
  pass: boolean;
  label: "PASS" | "FAIL";
  reasons: string[];
}

export interface EngineFlags {
  turbo: "TURBO" | "NON_TURBO";
  aspiration: "ELEVATION" | "N_ASPIRATED";
  condition: "REBUILT" | "CONVENTIONAL";
}

const GAS_LIMITS = {
  GAS: { co_pct: 3.5, hc_ppm: 600 },
  MOTORCYCLE: { co_pct: 4.5, hc_ppm: 7800 },
};

const DIESEL_LIMITS = {
  opacity_pct: 65,
  k_value: 2.5,
};

export function evaluateEmission(
  fuelType: FuelType,
  readings: Record<string, number | null | undefined>,
  _flags: EngineFlags,
): EmissionVerdict {
  const reasons: string[] = [];

  if (fuelType === "DIESEL") {
    const opacity = readings.opacity_pct;
    const kValue = readings.k_value;
    if (typeof opacity === "number" && opacity > DIESEL_LIMITS.opacity_pct) {
      reasons.push(`Opacity ${opacity}% exceeds ${DIESEL_LIMITS.opacity_pct}%`);
    }
    if (typeof kValue === "number" && kValue > DIESEL_LIMITS.k_value) {
      reasons.push(`K ${kValue} exceeds ${DIESEL_LIMITS.k_value}`);
    }
  } else {
    const limits = GAS_LIMITS[fuelType];
    const co = readings.co_pct;
    const hc = readings.hc_ppm;
    if (typeof co === "number" && co > limits.co_pct) {
      reasons.push(`CO ${co}% exceeds ${limits.co_pct}%`);
    }
    if (typeof hc === "number" && hc > limits.hc_ppm) {
      reasons.push(`HC ${hc} ppm exceeds ${limits.hc_ppm} ppm`);
    }
  }

  return {
    pass: reasons.length === 0,
    label: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
  };
}
