/**
 * Branding layer. Every user-facing vehicle/marque name is read from here so that
 * trademarks can be swapped (or licensed names restored) without touching gameplay code.
 * See docs/VEHICLE_SPEC.md §Branding.
 */
export const BRANDING = {
  marque: 'Cougar',
  model: 'Type E',
  fullName: 'Cougar Type E',
  variant: 'Series 1 4.2 Fixed Head Coupé',
  modelYear: 1965,
  engineName: '4.2L JET Inline-Six',
  engineFamily: 'JET',
  gameTitle: 'COUGAR TYPE E WORKSHOP',
  partPrefix: 'CTE',
  currency: '£',
} as const;

export const fmtMoney = (v: number) =>
  `${v < 0 ? '-' : ''}${BRANDING.currency}${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
