/**
 * Money helpers.
 *
 * Balances cross the wire as integer centavos and are only ever formatted to
 * pesos for display. Parsing back to centavos rounds at the boundary so a
 * decimal entered in a form cannot carry binary floating-point error into a
 * ledger row.
 */

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

/** 8000 -> "₱80.00" */
export function formatCentavos(centavos: number): string {
  return PESO.format(centavos / 100);
}

/** "80.5" -> 8050. Returns null when the input is not a usable amount. */
export function parsePesosToCentavos(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pesos = Number(trimmed);
  if (!Number.isFinite(pesos)) return null;
  return Math.round(pesos * 100);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}
