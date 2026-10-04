/** Fluid type database + per-circuit compatibility rules. */

export type FluidId =
  | 'oil_20w50' | 'oil_20w50_used' | 'oil_10w40' | 'oil_5w30_syn' | 'gear_ep90' | 'atf'
  | 'coolant_iat' | 'coolant_iat_old' | 'coolant_oat' | 'water'
  | 'brake_dot4' | 'brake_dot4_old' | 'brake_dot5' | 'brake_lhm'
  | 'petrol';

export type CircuitId = 'engineOil' | 'coolant' | 'brake' | 'clutch' | 'gearbox' | 'diff' | 'fuel';

export interface FluidDef {
  id: FluidId;
  name: string;
  color: number;         // render colour
  family: 'engine_oil' | 'gear_oil' | 'atf' | 'coolant' | 'water' | 'glycol_brake' | 'silicone_brake' | 'mineral_brake' | 'fuel';
  /** Relative kinematic viscosity at 90 °C (20W-50 = 1) and cold multiplier at 20 °C. */
  viscHot: number;
  viscCold: number;
  freshness: number;     // 1 = new, used oils lower
}

export const FLUIDS: Record<FluidId, FluidDef> = {
  oil_20w50: { id: 'oil_20w50', name: 'SAE 20W-50 classic mineral engine oil', color: 0xc8901a, family: 'engine_oil', viscHot: 1.0, viscCold: 5.5, freshness: 1 },
  oil_20w50_used: { id: 'oil_20w50_used', name: 'Used engine oil (20W-50)', color: 0x1b1408, family: 'engine_oil', viscHot: 0.85, viscCold: 5.0, freshness: 0.15 },
  oil_10w40: { id: 'oil_10w40', name: 'SAE 10W-40 semi-synthetic engine oil', color: 0xd09a2a, family: 'engine_oil', viscHot: 0.82, viscCold: 3.4, freshness: 1 },
  oil_5w30_syn: { id: 'oil_5w30_syn', name: 'SAE 5W-30 fully synthetic (modern)', color: 0xd8b040, family: 'engine_oil', viscHot: 0.62, viscCold: 2.2, freshness: 1 },
  gear_ep90: { id: 'gear_ep90', name: 'SAE 90 EP hypoid gear oil', color: 0x8a5a14, family: 'gear_oil', viscHot: 2.1, viscCold: 9, freshness: 1 },
  atf: { id: 'atf', name: 'Automatic transmission fluid (Dexron)', color: 0xb0141e, family: 'atf', viscHot: 0.38, viscCold: 1.6, freshness: 1 },
  coolant_iat: { id: 'coolant_iat', name: 'IAT antifreeze concentrate (blue, silicate)', color: 0x2a64d8, family: 'coolant', viscHot: 1, viscCold: 1, freshness: 1 },
  coolant_iat_old: { id: 'coolant_iat_old', name: 'Old coolant (depleted inhibitors)', color: 0x5a6a4a, family: 'coolant', viscHot: 1, viscCold: 1, freshness: 0.3 },
  coolant_oat: { id: 'coolant_oat', name: 'OAT antifreeze concentrate (orange, organic)', color: 0xe07818, family: 'coolant', viscHot: 1, viscCold: 1, freshness: 1 },
  water: { id: 'water', name: 'Clean water (distilled)', color: 0xa8c8e0, family: 'water', viscHot: 1, viscCold: 1, freshness: 1 },
  brake_dot4: { id: 'brake_dot4', name: 'DOT 4 glycol brake fluid', color: 0xd8c890, family: 'glycol_brake', viscHot: 1, viscCold: 1, freshness: 1 },
  brake_dot4_old: { id: 'brake_dot4_old', name: 'Old brake fluid (moisture-laden)', color: 0x7a5a20, family: 'glycol_brake', viscHot: 1, viscCold: 1, freshness: 0.4 },
  brake_dot5: { id: 'brake_dot5', name: 'DOT 5 silicone brake fluid', color: 0x7a3aa8, family: 'silicone_brake', viscHot: 1, viscCold: 1, freshness: 1 },
  brake_lhm: { id: 'brake_lhm', name: 'LHM mineral hydraulic fluid', color: 0x28a848, family: 'mineral_brake', viscHot: 1, viscCold: 1, freshness: 1 },
  petrol: { id: 'petrol', name: 'Petrol (super unleaded + lead substitute)', color: 0xe0d890, family: 'fuel', viscHot: 0.2, viscCold: 0.2, freshness: 1 },
};

export interface CircuitDef {
  id: CircuitId;
  name: string;
  capacityL: number;
  correct: FluidId[];
  /** Families that cause damage in this circuit, with explanation. */
  harmful: Partial<Record<FluidDef['family'], string>>;
}

export const CIRCUITS: Record<CircuitId, CircuitDef> = {
  engineOil: {
    id: 'engineOil', name: 'Engine oil', capacityL: 8.5, correct: ['oil_20w50'],
    harmful: {
      gear_oil: 'Hypoid gear oil is far too viscous when cold and its EP additives attack bronze/white-metal components — oil starvation on start-up.',
      atf: 'ATF is too thin to hold film strength in the JET bearings when hot — low oil pressure.',
      coolant: 'Glycol in the oil emulsifies it ("mayonnaise") and destroys bearings.',
      water: 'Water in the oil emulsifies it and causes corrosion and bearing failure.',
      glycol_brake: 'Brake fluid is not a lubricant.', fuel: 'Fuel dilutes the oil and destroys its viscosity.',
    },
  },
  coolant: {
    id: 'coolant', name: 'Cooling system', capacityL: 18.2, correct: ['coolant_iat', 'water'],
    harmful: { engine_oil: 'Oil in the coolant contaminates hoses and kills heat transfer.', fuel: 'Fuel in coolant is a fire hazard.' },
  },
  brake: {
    id: 'brake', name: 'Brake hydraulics', capacityL: 1.0, correct: ['brake_dot4'],
    harmful: {
      mineral_brake: 'Mineral fluid swells the natural-rubber seals of a glycol system — total brake failure within days.',
      engine_oil: 'Mineral oil swells and destroys the hydraulic seals.',
      silicone_brake: 'Silicone (DOT 5) must never be mixed with glycol fluid — it separates and leaves wet seals unprotected.',
      water: 'Water boils under heavy braking — vapour lock.',
    },
  },
  clutch: {
    id: 'clutch', name: 'Clutch hydraulics', capacityL: 0.35, correct: ['brake_dot4'],
    harmful: { mineral_brake: 'Mineral fluid swells the clutch master/slave seals.', engine_oil: 'Oil destroys the hydraulic seals.' },
  },
  gearbox: { id: 'gearbox', name: 'Gearbox', capacityL: 1.42, correct: ['gear_ep90'], harmful: { coolant: 'Glycol corrodes the gearbox.' } },
  diff: { id: 'diff', name: 'Final drive', capacityL: 1.56, correct: ['gear_ep90'], harmful: { atf: 'Too thin for the hypoid gears.' } },
  fuel: { id: 'fuel', name: 'Fuel tank', capacityL: 63.6, correct: ['petrol'], harmful: { engine_oil: 'Oil in fuel clogs jets.' } },
};

export type Composition = Partial<Record<FluidId, number>>;

export const total = (c: Composition) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);

export function addFluid(c: Composition, id: FluidId, l: number) {
  c[id] = (c[id] ?? 0) + l;
}

/** Remove a volume proportionally from a mixture; returns what was removed. */
export function removeFluid(c: Composition, l: number): Composition {
  const t = total(c);
  const out: Composition = {};
  if (t <= 0 || l <= 0) return out;
  const f = Math.min(1, l / t);
  for (const k of Object.keys(c) as FluidId[]) {
    const v = (c[k] ?? 0) * f;
    out[k] = v;
    c[k] = (c[k] ?? 0) - v;
    if ((c[k] ?? 0) < 1e-6) delete c[k];
  }
  return out;
}

export function dominant(c: Composition): FluidId | null {
  let best: FluidId | null = null, bv = 0;
  for (const [k, v] of Object.entries(c)) if ((v ?? 0) > bv) { bv = v ?? 0; best = k as FluidId; }
  return best;
}

/** Volume-weighted viscosity factor at temperature (°C). */
export function viscosity(c: Composition, tempC: number): number {
  const t = total(c);
  if (t <= 0) return 0;
  const k = Math.max(0, Math.min(1, (tempC - 20) / 70)); // 0 at 20 °C, 1 at 90 °C
  let v = 0;
  for (const [id, l] of Object.entries(c)) {
    const d = FLUIDS[id as FluidId];
    const cold = d.viscHot * d.viscCold;
    v += (l ?? 0) * Math.exp(Math.log(cold) * (1 - k) + Math.log(d.viscHot) * k);
  }
  return v / t;
}

export function freshness(c: Composition): number {
  const t = total(c);
  if (t <= 0) return 1;
  let f = 0;
  for (const [id, l] of Object.entries(c)) f += (l ?? 0) * FLUIDS[id as FluidId].freshness;
  return f / t;
}

/** Fraction (0..1) of the circuit filled with fluids that are wrong; plus explanatory problems. */
export function compatibility(circuit: CircuitId, c: Composition): { wrongFrac: number; problems: string[] } {
  const def = CIRCUITS[circuit];
  const t = total(c);
  if (t <= 0) return { wrongFrac: 0, problems: [] };
  let wrong = 0;
  const problems = new Set<string>();
  for (const [id, l] of Object.entries(c)) {
    const fd = FLUIDS[id as FluidId];
    const ok = def.correct.includes(fd.id) || (circuit === 'engineOil' && fd.family === 'engine_oil')
      || (circuit === 'brake' || circuit === 'clutch' ? fd.family === 'glycol_brake' : false)
      || (circuit === 'coolant' && fd.family === 'coolant' && fd.id !== 'coolant_oat');
    if (!ok) {
      wrong += l ?? 0;
      const msg = def.harmful[fd.family];
      if (msg) problems.add(msg);
      if (circuit === 'coolant' && fd.id === 'coolant_oat' && (c.coolant_iat ?? 0) + (c.coolant_iat_old ?? 0) > 0.5)
        problems.add('Mixing OAT and IAT antifreeze can form gel/sludge that blocks the radiator tubes.');
    }
  }
  if (circuit === 'engineOil') {
    const thin = (c.oil_5w30_syn ?? 0) / t;
    if (thin > 0.3) problems.add('Modern thin synthetic oil gives low hot oil pressure and weeps past the rope-type rear crankshaft seal of the JET engine.');
  }
  return { wrongFrac: wrong / t, problems: [...problems] };
}

/** Antifreeze fraction of a coolant mixture and its freezing protection (°C). */
export function antifreeze(c: Composition): { frac: number; freezeC: number } {
  const t = total(c);
  if (t <= 0) return { frac: 0, freezeC: 0 };
  const glycol = (c.coolant_iat ?? 0) + (c.coolant_oat ?? 0) + (c.coolant_iat_old ?? 0) * 0.5;
  const frac = glycol / t;
  // Approximate ethylene-glycol freezing curve (20 % → −8 °C, 50 % → −37 °C, 60 % → −52 °C)
  const freezeC = -Math.min(60, 16 * frac + 120 * frac * frac);
  return { frac, freezeC };
}
