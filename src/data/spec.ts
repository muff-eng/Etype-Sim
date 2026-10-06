/**
 * Vehicle specification database — single source of truth for the simulated variant.
 *
 * Variant: 1965 model-year Series 1 4.2 Fixed Head Coupé, right-hand drive, 9:1 compression,
 * all-synchromesh 4-speed, alternator / negative earth (see docs/VEHICLE_SPEC.md).
 *
 * status:
 *  - 'reference'   cross-checked against published owner/club/supplier data for this variant
 *  - 'provisional' best available figure, flagged for verification against the factory
 *                  service manual before it is relied on (shown with a † in the in-game manual)
 */
import { BRANDING } from '../config/branding';

export type SpecStatus = 'reference' | 'provisional';
export interface SpecValue {
  label: string;
  value: number | string;
  unit?: string;
  alt?: string;          // alternate unit display (imperial)
  min?: number;
  max?: number;
  status: SpecStatus;
  note?: string;
}

const r = (label: string, value: number | string, unit?: string, alt?: string, extra: Partial<SpecValue> = {}): SpecValue =>
  ({ label, value, unit, alt, status: 'reference', ...extra });
const p = (label: string, value: number | string, unit?: string, alt?: string, extra: Partial<SpecValue> = {}): SpecValue =>
  ({ label, value, unit, alt, status: 'provisional', ...extra });

export const VEHICLE_ID = 'CTE_S1_42_FHC_1965';

export const SPEC = {
  identity: {
    name: r('Vehicle', `${BRANDING.fullName} ${BRANDING.variant}`),
    year: r('Model year', BRANDING.modelYear),
    series: r('Series', 'Series 1 (4.2 litre, covered headlamps)'),
    body: r('Body', 'Fixed Head Coupé (monocoque centre section, bolted tubular front frame)'),
    drive: r('Steering position', 'Right-hand drive (home market)'),
  },
  dimensions: {
    length: r('Overall length', 4453, 'mm', '175.3 in'),
    width: r('Overall width', 1657, 'mm', '65.25 in'),
    height: r('Overall height', 1219, 'mm', '48 in'),
    wheelbase: r('Wheelbase', 2438, 'mm', '96 in'),
    trackF: r('Front track', 1270, 'mm', '50 in'),
    trackR: r('Rear track', 1270, 'mm', '50 in'),
    clearance: r('Ground clearance', 140, 'mm', '5.5 in'),
    kerb: p('Kerb weight (approx.)', 1257, 'kg', '24.75 cwt'),
  },
  engine: {
    name: r('Engine', BRANDING.engineName),
    layout: r('Layout', 'In-line 6, twin overhead camshafts, 2 valves/cyl, hemispherical combustion chambers'),
    capacity: r('Capacity', 4235, 'cc', '258.4 cu in'),
    bore: r('Bore', 92.07, 'mm', '3.625 in'),
    stroke: r('Stroke', 106, 'mm', '4.17 in'),
    compression: r('Compression ratio', '9 : 1', undefined, undefined, { note: '8 : 1 optional — not simulated' }),
    firingOrder: r('Firing order', '1-5-3-6-2-4', undefined, undefined, { note: 'No. 1 cylinder at the REAR (flywheel end)' }),
    power: r('Max power (gross)', 265, 'bhp', '@ 5400 rpm'),
    torque: r('Max torque (gross)', 283, 'lb ft', '@ 4000 rpm'),
    idle: p('Idle speed (hot)', 700, 'rpm'),
    valveClearanceIn: r('Valve clearance, inlet (cold)', 0.10, 'mm', '0.004 in', { min: 0.09, max: 0.11, note: 'Early cam profile; later 4.2 engines 0.012–0.014 in' }),
    valveClearanceEx: r('Valve clearance, exhaust (cold)', 0.15, 'mm', '0.006 in', { min: 0.14, max: 0.16 }),
    compressionPressure: p('Compression pressure (cranking, warm, WOT)', 150, 'psi', undefined, { min: 140, max: 170 }),
    crankMainJournal: p('Crankshaft main journal Ø', '69.850–69.863', 'mm', '2.7500–2.7505 in', { min: 69.85, max: 69.863 }),
    crankPin: p('Crankpin Ø', '52.97–52.98', 'mm', '2.0855–2.086 in', { min: 52.97, max: 52.98 }),
    crankEndFloat: p('Crankshaft end float', '0.10–0.15', 'mm', '0.004–0.006 in', { min: 0.10, max: 0.15 }),
  },
  ignition: {
    distributor: p('Distributor', 'Lucas 22D6 type, mechanical + vacuum advance'),
    pointsGap: p('Contact breaker gap', '0.36–0.41', 'mm', '0.014–0.016 in', { min: 0.36, max: 0.41 }),
    timing: r('Static ignition timing (9:1)', 10, '° BTDC'),
    plugs: r('Spark plugs', 'Champion N5 (until Mar 1967)', undefined, undefined, { note: 'Later cars: N11Y' }),
    plugGap: r('Spark plug gap', 0.64, 'mm', '0.025 in', { min: 0.61, max: 0.66 }),
    plugThread: r('Spark plug thread / hex', '14 mm long reach / 13/16 in hex'),
    coil: p('Ignition coil', '12 V oil-filled, primary ≈ 3 Ω'),
  },
  fuel: {
    carbs: r('Carburettors', '3 × SU HD8 (2 in)'),
    pump: p('Fuel pump', 'Electric, immersed in tank'),
    tank: r('Fuel tank', 63.6, 'L', '14 Imp gal'),
    fuel: r('Fuel', 'Premium leaded / modern 97+ RON with additive'),
  },
  lubrication: {
    capacity: r('Engine oil refill (incl. filter)', 8.5, 'L', '15 Imp pints / 18 US pints'),
    grade: r('Oil grade', 'SAE 20W-50 mineral (classic specification)'),
    filter: r('Oil filter', 'Full-flow canister with replaceable paper element and head sealing ring'),
    pressure: p('Oil pressure (hot)', 40, 'psi', '@ 3000 rpm', { min: 35, max: 45 }),
    pressureIdle: p('Oil pressure (hot idle, minimum)', 15, 'psi'),
    dipstickSpan: p('Dipstick MIN→MAX', 1.7, 'L', '≈ 3 Imp pints'),
  },
  cooling: {
    capacity: r('Cooling system (incl. heater)', 18.2, 'L', '32 Imp pints / 38.5 US pints'),
    coolant: r('Coolant', '50% ethylene-glycol antifreeze (IAT, silicate-inhibited) / 50% water'),
    thermostat: p('Thermostat opening', '73–78', '°C', undefined, { min: 73, max: 78 }),
    cap: p('Pressure cap', 4, 'psi'),
    fan: r('Fan', 'Electric, thermostatically switched'),
  },
  transmission: {
    gearbox: r('Gearbox', '4-speed all-synchromesh'),
    ratios: p('Gear ratios', '2.68 / 1.74 / 1.27 / 1.00, R 3.10'),
    capacity: r('Gearbox oil', 1.42, 'L', '2.5 Imp pints / 3 US pints'),
    oil: p('Gearbox lubricant', 'SAE 90 EP gear oil'),
    clutch: r('Clutch', 'Borg & Beck 10 in diaphragm spring, hydraulic'),
  },
  finalDrive: {
    type: r('Final drive', 'Salisbury hypoid with Powr-Lok limited-slip differential'),
    ratio: p('Ratio (home market)', '3.07 : 1'),
    capacity: p('Differential oil', 1.56, 'L', '2.75 Imp pints'),
    oil: p('Differential lubricant', 'SAE 90 hypoid, limited-slip compatible'),
  },
  brakes: {
    type: r('Brakes', 'Discs all round, servo-assisted; rear discs inboard'),
    discF: r('Front disc Ø', 279, 'mm', '11 in'),
    discR: r('Rear disc Ø', 254, 'mm', '10 in'),
    discFThick: p('Front disc thickness (new / min)', '12.7 / 11.4', 'mm', undefined, { min: 11.4, max: 12.7 }),
    padMin: p('Pad friction material minimum', 3, 'mm'),
    fluid: r('Brake / clutch fluid', 'Glycol-based (SAE J1703 / DOT 4 compatible). NEVER mineral (LHM) or silicone (DOT 5).'),
  },
  suspension: {
    front: r('Front suspension', 'Independent: unequal-length wishbones, longitudinal torsion bars, telescopic dampers, anti-roll bar'),
    rear: r('Rear suspension', 'Independent: lower wishbones, driveshafts as upper links, radius arms, twin coil-spring/damper units per side, anti-roll bar'),
    steering: r('Steering', 'Rack and pinion'),
  },
  wheels: {
    wheels: r('Wheels', '72-spoke wire, 15 × 5K, centre-lock eared spinners'),
    spinnerThreads: r('Spinner threads', 'Right side: right-hand thread · Left side: left-hand thread (undo towards rear of car)'),
    tyres: r('Tyres', '185 VR 15 radial'),
    pressureF: r('Tyre pressure, front (cold)', 32, 'psi', undefined, { min: 31, max: 33 }),
    pressureR: r('Tyre pressure, rear (cold)', 32, 'psi', undefined, { min: 31, max: 33 }),
    treadMin: r('Minimum legal tread (UK)', 1.6, 'mm'),
  },
  electrical: {
    system: r('System', '12 V, NEGATIVE earth'),
    battery: p('Battery', '12 V lead-acid, ≈ 60 Ah'),
    charging: r('Charging', 'Alternator with separate voltage regulator'),
    chargeV: p('Regulated charging voltage', '14.0–14.4', 'V', undefined, { min: 14.0, max: 14.4 }),
    starter: p('Starter', 'Pre-engaged, solenoid on motor'),
    fuses: p('Fuses', '6 × glass cartridge, behind centre instrument panel', undefined, undefined, { note: 'Circuit grouping simplified in this build' }),
    beltDeflection: p('Fan/alternator belt deflection', '10–13', 'mm', '≈ 1/2 in at mid-span, firm thumb pressure', { min: 10, max: 13 }),
  },
} as const;

export type SpecSection = keyof typeof SPEC;

/** Torque reference values (Nm). Slot definitions refer to these keys so the manual and gameplay never disagree. */
export const TORQUE: Record<string, { label: string; nm: number; lbft: number; status: SpecStatus; note?: string }> = {
  headNuts: { label: 'Cylinder head nuts', nm: 73, lbft: 54, status: 'reference', note: 'Composite gasket; follow spiral sequence from centre' },
  mainBearing: { label: 'Main bearing cap bolts', nm: 113, lbft: 83, status: 'provisional' },
  conrod: { label: 'Connecting rod nuts', nm: 50, lbft: 37, status: 'provisional' },
  flywheel: { label: 'Flywheel bolts', nm: 91, lbft: 67, status: 'provisional' },
  camCaps: { label: 'Camshaft bearing cap nuts', nm: 12, lbft: 9, status: 'provisional' },
  camCover: { label: 'Camshaft cover domed nuts', nm: 7, lbft: 5, status: 'provisional' },
  sparkPlug: { label: 'Spark plugs (alloy head)', nm: 37, lbft: 27, status: 'provisional' },
  drainPlug: { label: 'Sump drain plug', nm: 34, lbft: 25, status: 'provisional' },
  filterBolt: { label: 'Oil filter canister centre bolt', nm: 20, lbft: 15, status: 'provisional' },
  sumpBolts: { label: 'Sump to block bolts', nm: 20, lbft: 15, status: 'provisional' },
  engineMount: { label: 'Engine mounting bolts', nm: 40, lbft: 30, status: 'provisional' },
  battClamp: { label: 'Battery terminal pinch bolts', nm: 5, lbft: 3.7, status: 'provisional' },
  battHold: { label: 'Battery hold-down nuts', nm: 4, lbft: 3, status: 'provisional', note: 'Snug only — do not crack the case' },
  hoseClip: { label: 'Worm-drive hose clips', nm: 3.5, lbft: 2.6, status: 'provisional' },
  altPivot: { label: 'Alternator pivot bolt', nm: 27, lbft: 20, status: 'provisional' },
  altAdjust: { label: 'Alternator adjusting-link bolt', nm: 20, lbft: 15, status: 'provisional' },
  fillPlugGbx: { label: 'Gearbox filler/level plug', nm: 34, lbft: 25, status: 'provisional' },
  fillPlugDiff: { label: 'Differential filler/level plug', nm: 34, lbft: 25, status: 'provisional' },
  airCover: { label: 'Air cleaner end-cover wing nuts', nm: 3, lbft: 2.2, status: 'provisional', note: 'Hand tight' },
  panelScrew: { label: 'Centre panel thumb screws', nm: 1, lbft: 0.7, status: 'provisional', note: 'Finger tight' },
};

/** Maintenance schedule (miles) — summarised for the manual. */
export const MAINTENANCE: { interval: string; items: string[] }[] = [
  { interval: 'Weekly / before long journeys', items: ['Engine oil level (dipstick, car level, engine stopped ≥ 2 min)', 'Coolant level in header tank (COLD only)', 'Brake & clutch fluid reservoirs', 'Tyre pressures (cold)', 'Lights, horn and wipers'] },
  { interval: 'Every 2,500 miles', items: ['Change engine oil', 'Lubricate distributor cam and advance mechanism (sparingly)', 'Check fan/alternator belt tension', 'Check battery electrolyte & terminals'] },
  { interval: 'Every 5,000 miles', items: ['Renew oil filter element & sealing ring', 'Clean / gap spark plugs', 'Check contact breaker gap & dwell; check static timing', 'Check gearbox and differential oil levels', 'Inspect brake pads & discs', 'Grease chassis points'] },
  { interval: 'Every 10,000 miles', items: ['Renew spark plugs', 'Renew air cleaner element', 'Check valve clearances', 'Tune carburettors (synchronise & mixture)', 'Inspect hoses & clips; check antifreeze strength'] },
  { interval: 'Every 2 years', items: ['Renew brake and clutch fluid', 'Renew coolant (IAT 50 %)'] },
];
