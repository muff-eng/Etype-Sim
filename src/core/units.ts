export const NM_PER_LBFT = 1.35582;
export const MM_PER_IN = 25.4;
export const L_PER_IMP_PINT = 0.568261;
export const KPA_PER_PSI = 6.89476;

export const lbft = (v: number) => v * NM_PER_LBFT;
export const toLbft = (nm: number) => nm / NM_PER_LBFT;
export const inch = (v: number) => v * MM_PER_IN;
export const impPints = (v: number) => v * L_PER_IMP_PINT;

/** AF (across-flats, imperial) sizes in mm, as used on the 4.2 JET engine and chassis. */
export const AF: Record<string, number> = {
  '1/4 AF': 6.35, '5/16 AF': 7.94, '3/8 AF': 9.53, '7/16 AF': 11.11, '1/2 AF': 12.7,
  '9/16 AF': 14.29, '5/8 AF': 15.88, '11/16 AF': 17.46, '3/4 AF': 19.05, '13/16 AF': 20.64,
  '7/8 AF': 22.23, '15/16 AF': 23.81, '1 AF': 25.4, '1-1/16 AF': 26.99,
  '10 mm': 10, '11 mm': 11, '12 mm': 12, '13 mm': 13, '14 mm': 14, '17 mm': 17, '19 mm': 19, '21 mm': 21, '22 mm': 22, '24 mm': 24,
};

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const fmt = (v: number, d = 2) => v.toFixed(d);
