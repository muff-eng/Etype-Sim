/**
 * Part (item) definitions. A PartDef describes a *type* of physical item; PartState (sim/types)
 * is an individual instance with its own condition. Vehicle locations are SlotDefs (data/slots.ts).
 */
import type { PartState, SystemId } from '../sim/types';
import type { ToolKind } from './tools';
import type { Composition } from './fluids';
import { BRANDING } from '../config/branding';
import { hashStr } from '../core/rng';
import { SPEC } from './spec';

export interface MeasurementDef {
  id: string;
  label: string;
  tools: ToolKind[];
  unit: string;
  decimals: number;
  spec?: { min?: number; max?: number; label: string; serviceLimit?: number };
  read: (p: PartState) => number;
  where: 'installed' | 'removed' | 'any';
  phase?: number;
}

export interface PartDef {
  id: string;
  name: string;
  partNo: string;
  system: SystemId;
  mass: number;     // kg
  price: number;    // new retail
  kind: 'component' | 'fastener' | 'consumable' | 'container' | 'kit';
  desc?: string;
  edu?: string;
  measurements?: MeasurementDef[];
  inspect?: (p: PartState) => string[];
  defaults?: Record<string, number>;
  newVars?: (seed: string) => Record<string, number>;
  fluid?: Composition;          // containers: initial composition
  catalog?: boolean;            // offered in the parts computer
  bundle?: string[];            // kit contents
  cleanable?: boolean;
  wrongFor?: string;            // explanation if fitted where it shouldn't be
}

export const PARTS: Record<string, PartDef> = {};

export function partNo(id: string) {
  return `${BRANDING.partPrefix}-${(hashStr(id) % 90000 + 10000).toString()}`;
}

export function definePart(d: Omit<PartDef, 'partNo'> & { partNo?: string }): PartDef {
  const full = { partNo: partNo(d.id), ...d } as PartDef;
  PARTS[d.id] = full;
  return full;
}

const seeded = (seed: string, a: number, b: number) => a + ((hashStr(seed) % 1000) / 1000) * (b - a);

// ───────────────────────── Lubrication ─────────────────────────
definePart({
  id: 'drain_plug', name: 'Sump drain plug', system: 'lubrication', mass: 0.08, price: 6, kind: 'fastener', catalog: true, edu: 'drain_plug',
  inspect: (p) => [p.flags.includes('rounded') ? 'Hex flats rounded — a poorly fitting tool has been used.' : 'Hex flats crisp.', 'Magnetic tip: ' + ((p.vars.metal ?? 0) > 0.4 ? 'fine grey metallic paste — monitor bearing wear.' : 'light dusting of fine particles — normal.')],
});
definePart({
  id: 'washer_drain', name: 'Drain plug sealing washer (copper)', system: 'lubrication', mass: 0.005, price: 0.8, kind: 'consumable', catalog: true, edu: 'crush_washer',
  inspect: (p) => [p.flags.includes('crushed') ? 'Washer flattened and grooved by the plug — crush washers are single-use.' : 'New, unmarked washer.'],
});
definePart({
  id: 'filter_element', name: 'Oil filter element (paper)', system: 'lubrication', mass: 0.2, price: 9, kind: 'consumable', catalog: true, edu: 'oil_filter',
  defaults: { clog: 0 },
  inspect: (p) => [(p.vars.clog ?? 0) > 0.6 ? 'Pleats saturated with black sludge — long overdue.' : (p.vars.clog ?? 0) > 0.2 ? 'Element dark and loaded with deposits — due for renewal.' : 'Clean new element.'],
});
definePart({
  id: 'filter_seal', name: 'Filter head sealing ring', system: 'lubrication', mass: 0.01, price: 2, kind: 'consumable', catalog: true, edu: 'oil_filter',
  inspect: (p) => [p.flags.includes('hardened') ? 'Ring flattened, glossy and hard — it has taken a permanent set and will weep.' : 'Supple rubber ring, square section intact.'],
});
definePart({ id: 'filter_kit', name: 'Oil filter kit (element + sealing ring)', system: 'lubrication', mass: 0.22, price: 11, kind: 'kit', catalog: true, bundle: ['filter_element', 'filter_seal'] });
definePart({ id: 'filter_canister', name: 'Oil filter canister (bowl)', system: 'lubrication', mass: 0.6, price: 48, kind: 'component', edu: 'oil_filter', cleanable: true });
definePart({ id: 'filter_bolt', name: 'Filter canister centre bolt', system: 'lubrication', mass: 0.1, price: 7, kind: 'fastener', edu: 'oil_filter' });
definePart({ id: 'filler_cap', name: 'Oil filler cap (knurled)', system: 'lubrication', mass: 0.15, price: 22, kind: 'component' });
definePart({ id: 'dipstick', name: 'Engine oil dipstick', system: 'lubrication', mass: 0.1, price: 14, kind: 'component', edu: 'dipstick' });

// ───────────────────────── Ignition ─────────────────────────
const plugInspect = (p: PartState) => {
  const out: string[] = [];
  const f = p.vars.fouling ?? 0, oil = p.vars.oily ?? 0, wear = p.vars.wear ?? 0;
  if ((p.vars.new ?? 0) > 0) out.push('New plug — gap must be checked and set before fitting.');
  else if (f > 0.6) out.push('Dry, black, sooty deposits over the insulator nose and electrodes — this cylinder has been misfiring or running rich.');
  else if (oil > 0.5) out.push('Wet, oily black deposits — oil is reaching the chamber (rings/valve guides).');
  else out.push('Insulator nose light tan/grey — healthy combustion.');
  if (wear > 0.5) out.push('Centre electrode rounded and side electrode thinned — gap has grown with wear.');
  if (p.flags.includes('cracked')) out.push('Hairline crack in the insulator — the plug has been dropped or over-tightened.');
  if (p.def === 'plug_l82y') out.push('Thread length is SHORT (3/8 in reach) — this is not the correct long-reach plug for an alloy JET head.');
  return out;
};
const plugMeas: MeasurementDef[] = [{
  id: 'gap', label: 'Electrode gap', tools: ['feeler_gauge'], unit: 'mm', decimals: 2, where: 'removed',
  spec: { min: SPEC.ignition.plugGap.min, max: SPEC.ignition.plugGap.max, label: '0.61–0.66 mm (0.025 in)' }, read: (p) => p.vars.gap ?? 0.64,
}];
definePart({
  id: 'plug_n5', name: 'Spark plug — Champion N5 (long reach)', system: 'ignition', mass: 0.05, price: 6.5, kind: 'component', catalog: true, edu: 'spark_plug',
  measurements: plugMeas, inspect: plugInspect,
  newVars: (s) => ({ gap: +seeded(s, 0.74, 0.84).toFixed(2), fouling: 0, oily: 0, wear: 0, new: 1 }),
});
definePart({
  id: 'plug_l82y', name: 'Spark plug — short-reach L-type (wrong application)', system: 'ignition', mass: 0.04, price: 3.2, kind: 'component', catalog: true, edu: 'spark_plug',
  measurements: plugMeas, inspect: plugInspect, wrongFor: 'Short-reach plug in a long-reach head: the electrode sits recessed, misfires, and carbon fills the exposed threads.',
  newVars: (s) => ({ gap: +seeded(s, 0.7, 0.8).toFixed(2), fouling: 0, oily: 0, wear: 0, new: 1 }),
});
definePart({ id: 'ht_lead', name: 'HT lead (7 mm, copper core)', system: 'ignition', mass: 0.05, price: 4, kind: 'component', catalog: true, edu: 'ht_lead' });
definePart({ id: 'dist_cap', name: 'Distributor cap', system: 'ignition', mass: 0.15, price: 16, kind: 'component', catalog: true, edu: 'distributor',
  inspect: (p) => [p.flags.includes('cracked') ? 'Carbon tracking line between two segments — the spark is jumping to the wrong cylinder.' : 'No cracks or tracking; segments lightly burnt — normal.'] });
definePart({ id: 'rotor', name: 'Rotor arm', system: 'ignition', mass: 0.02, price: 6, kind: 'component', catalog: true, edu: 'distributor' });

// ───────────────────────── Electrical ─────────────────────────
definePart({
  id: 'battery_60ah', name: 'Battery 12 V 60 Ah (lead-acid)', system: 'electrical', mass: 19, price: 115, kind: 'component', catalog: true, edu: 'battery',
  defaults: { charge: 1, health: 1 },
  inspect: (p) => {
    const o = [p.flags.includes('corroded') ? 'Fluffy white/green sulphate crystals on the positive post.' : 'Posts clean.'];
    if ((p.vars.health ?? 1) < 0.6) o.push('Case slightly bulged; plates visible through filler holes are sulphated.');
    o.push(`Date code: ${(p.vars.age ?? 0) > 4 ? 'over 5 years old' : 'recent'}.`);
    return o;
  },
  measurements: [{ id: 'load', label: 'Voltage under 10 s load test', tools: ['battery_tester'], unit: 'V', decimals: 1, where: 'any', spec: { min: 9.6, label: '≥ 9.6 V at end of 10 s load' }, read: (p) => 11.8 + 0.85 * (p.vars.charge ?? 1) - 2.6 / Math.max(0.2, (p.vars.health ?? 1) * (0.5 + 0.5 * (p.vars.charge ?? 1))) }],
});
definePart({
  id: 'term_clamp', name: 'Battery terminal clamp', system: 'electrical', mass: 0.1, price: 5, kind: 'component', catalog: true, edu: 'battery',
  inspect: (p) => [p.flags.includes('corroded') ? 'Thick crust of sulphate corrosion between clamp and post — a high-resistance joint.' : p.flags.includes('greased') ? 'Bright metal with a thin protective film.' : 'Contact faces clean.'],
});
for (const a of [25, 35, 50] as const) {
  definePart({
    id: `fuse_${a}a`, name: `Glass cartridge fuse ${a} A`, system: 'electrical', mass: 0.002, price: 0.4, kind: 'consumable', catalog: true, edu: 'fuse',
    defaults: { rating: a },
    inspect: (p) => [p.flags.includes('blown') ? 'Fuse element melted through — circuit open.' : 'Element intact.', `Rated ${a} A.`],
  });
}
definePart({
  id: 'fan_belt', name: 'Fan / alternator V-belt', system: 'engine', mass: 0.2, price: 12, kind: 'component', catalog: true, edu: 'fan_belt',
  defaults: { wear: 0 },
  inspect: (p) => [p.flags.includes('glazed') ? 'Belt flanks glazed shiny — it has been slipping on the pulleys.' : 'Flanks matt, no cracks.', (p.vars.wear ?? 0) > 0.6 ? 'Fine cracks across the inner face.' : 'Inner face intact.'],
  measurements: [{ id: 'deflection', label: 'Belt deflection at mid-span', tools: ['ruler'], unit: 'mm', decimals: 0, where: 'installed', spec: { min: 10, max: 13, label: '10–13 mm (≈ 1/2 in)' }, read: (p) => p.vars.deflection ?? 12 }],
});

// ───────────────────────── Cooling ─────────────────────────
definePart({ id: 'hose_clip', name: 'Worm-drive hose clip', system: 'cooling', mass: 0.02, price: 1.5, kind: 'fastener', catalog: true, edu: 'hose_clip' });
definePart({
  id: 'bottom_hose', name: 'Radiator bottom hose', system: 'cooling', mass: 0.3, price: 18, kind: 'component', catalog: true, edu: 'hoses',
  inspect: (p) => [p.flags.includes('leaking') ? 'Crusty blue-white dried coolant around the radiator-end clip; damp underneath.' : 'Hose firm, no residue.', p.flags.includes('hardened') ? 'Rubber hard and cracked at the ends.' : 'Rubber supple.'],
});
definePart({ id: 'header_cap', name: 'Header tank pressure cap', system: 'cooling', mass: 0.1, price: 9, kind: 'component', catalog: true, edu: 'pressure_cap' });

// ───────────────────────── Fuel / induction ─────────────────────────
definePart({
  id: 'air_element', name: 'Air cleaner element', system: 'fuel', mass: 0.3, price: 14, kind: 'consumable', catalog: true, edu: 'air_filter',
  defaults: { clog: 0 },
  inspect: (p) => [(p.vars.clog ?? 0) > 0.5 ? 'Element grey-black and clogged with dust and insects.' : 'Element clean.'],
});

// ───────────────────────── Wheels & tyres ─────────────────────────
definePart({
  id: 'wheel_wire', name: 'Wire wheel 15 × 5K with 185 VR 15 tyre', system: 'wheels', mass: 20, price: 420, kind: 'component', catalog: true, edu: 'wire_wheel',
  defaults: { pressure: 32, tread: 6.5, leak: 0 },
  inspect: (p) => {
    const o: string[] = [];
    if (p.flags.includes('punctured')) o.push('Roofing nail embedded in the outer tread rib.');
    o.push((p.vars.tread ?? 6) < 2 ? 'Tread close to the wear indicators.' : 'Tread even across the width.');
    if ((p.vars.pressure ?? 32) < 24) o.push('Tyre visibly bulged at the contact patch.');
    o.push(p.flags.includes('dirty') ? 'Spokes dirty; no loose spokes found.' : 'Spokes tight — even ring when tapped.');
    return o;
  },
  measurements: [
    { id: 'pressure', label: 'Tyre pressure (cold)', tools: ['tyre_gauge'], unit: 'psi', decimals: 1, where: 'any', spec: { min: 31, max: 33, label: '32 psi cold' }, read: (p) => p.vars.pressure ?? 32 },
    { id: 'tread', label: 'Tread depth', tools: ['tread_gauge'], unit: 'mm', decimals: 1, where: 'any', spec: { min: 1.6, label: '≥ 1.6 mm (legal minimum)' }, read: (p) => p.vars.tread ?? 6 },
  ],
});
definePart({ id: 'spinner_l', name: 'Eared spinner — left side (LH thread)', system: 'wheels', mass: 0.9, price: 85, kind: 'fastener', catalog: true, edu: 'spinner',
  inspect: (p) => [p.flags.includes('chipped') ? 'Chrome chipped on the ears — struck with a steel hammer.' : 'Chrome intact; "UNDO" arrow points towards the rear.'] });
definePart({ id: 'spinner_r', name: 'Eared spinner — right side (RH thread)', system: 'wheels', mass: 0.9, price: 85, kind: 'fastener', catalog: true, edu: 'spinner',
  inspect: (p) => [p.flags.includes('chipped') ? 'Chrome chipped on the ears — struck with a steel hammer.' : 'Chrome intact; "UNDO" arrow points towards the rear.'] });

// ───────────────────────── Brakes ─────────────────────────
definePart({
  id: 'brake_disc_f', name: 'Front brake disc 11 in', system: 'brakes', mass: 6, price: 65, kind: 'component', catalog: true, edu: 'brake_disc',
  defaults: { thickness: 12.4 },
  inspect: (p) => [(p.vars.thickness ?? 12.7) < 11.6 ? 'Pronounced lip at the outer edge; deep concentric scoring.' : 'Light even scoring, small rust lip at the edge.'],
  measurements: [{ id: 'thickness', label: 'Disc thickness', tools: ['vernier', 'micrometer'], unit: 'mm', decimals: 2, where: 'installed', spec: { min: 11.4, label: 'New 12.7 mm, minimum 11.4 mm' }, read: (p) => p.vars.thickness ?? 12.7 }],
});
definePart({
  id: 'brake_pads_f', name: 'Front brake pad set', system: 'brakes', mass: 0.8, price: 32, kind: 'component', catalog: true, edu: 'brake_pads',
  defaults: { thickness: 7 },
  measurements: [{ id: 'thickness', label: 'Pad friction material', tools: ['vernier', 'ruler'], unit: 'mm', decimals: 1, where: 'installed', spec: { min: 3, label: '≥ 3 mm friction material' }, read: (p) => p.vars.thickness ?? 9 }],
});

// ───────────────────────── Engine internals (Tier II groundwork) ─────────────────────────
definePart({
  id: 'crankshaft', name: 'Crankshaft (7 main bearings)', system: 'engine', mass: 27, price: 950, kind: 'component', edu: 'crankshaft',
  measurements: [1, 2, 3, 4, 5, 6, 7].map<MeasurementDef>((n) => ({
    id: `main${n}`, label: `Main journal #${n}`, tools: ['micrometer'], unit: 'mm', decimals: 3, where: 'removed', phase: 3,
    spec: { min: 69.85, max: 69.863, label: '69.850–69.863 mm', serviceLimit: 69.83 }, read: (p) => 69.863 - (p.vars[`wear${n}`] ?? 0.004),
  })),
});
definePart({ id: 'piston', name: 'Piston 92.07 mm with rings', system: 'engine', mass: 0.7, price: 120, kind: 'component', edu: 'piston' });
definePart({ id: 'conrod', name: 'Connecting rod', system: 'engine', mass: 1.0, price: 180, kind: 'component', edu: 'conrod' });

// ───────────────────────── Fluid containers ─────────────────────────
const container = (id: string, name: string, system: SystemId, price: number, fluid: Composition, mass: number) =>
  definePart({ id, name, system, price, mass, kind: 'container', catalog: true, fluid });
container('oil_20w50_5l', '20W-50 classic mineral engine oil — 5 L', 'lubrication', 36, { oil_20w50: 5 }, 4.6);
container('oil_20w50_1l', '20W-50 classic mineral engine oil — 1 L', 'lubrication', 9, { oil_20w50: 1 }, 0.95);
container('oil_10w40_5l', '10W-40 semi-synthetic engine oil — 5 L', 'lubrication', 27, { oil_10w40: 5 }, 4.5);
container('oil_5w30_5l', '5W-30 fully synthetic engine oil — 5 L', 'lubrication', 41, { oil_5w30_syn: 5 }, 4.4);
container('gear_ep90_1l', 'SAE 90 EP hypoid gear oil — 1 L', 'transmission', 11, { gear_ep90: 1 }, 0.95);
container('atf_1l', 'Automatic transmission fluid — 1 L', 'transmission', 9, { atf: 1 }, 0.9);
container('coolant_premix_5l', 'Coolant — IAT 50/50 premixed — 5 L', 'cooling', 16, { coolant_iat: 2.5, water: 2.5 }, 5.2);
container('coolant_iat_5l', 'Antifreeze IAT concentrate (blue) — 5 L', 'cooling', 22, { coolant_iat: 5 }, 5.5);
container('coolant_oat_5l', 'Antifreeze OAT concentrate (orange) — 5 L', 'cooling', 20, { coolant_oat: 5 }, 5.5);
container('water_5l', 'Distilled water — 5 L', 'cooling', 3, { water: 5 }, 5);
container('brake_dot4_05l', 'DOT 4 brake fluid — 0.5 L', 'brakes', 8, { brake_dot4: 0.5 }, 0.55);
container('brake_dot5_05l', 'DOT 5 silicone brake fluid — 0.5 L', 'brakes', 16, { brake_dot5: 0.5 }, 0.55);
container('brake_lhm_1l', 'LHM mineral hydraulic fluid — 1 L', 'brakes', 12, { brake_lhm: 1 }, 0.9);
