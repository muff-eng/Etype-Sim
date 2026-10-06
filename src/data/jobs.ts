/** Tier work orders. Customers describe symptoms — never causes. */
import type { SystemId } from '../sim/types';
import type { VehicleState } from '../sim/vehicle';
import { partIn } from '../sim/vehicle';

export interface JobDef {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  customer: string;
  complaint: string;
  requests: string[];
  faults: string[];
  bookHours: number;
  procedures: string[];
  skills: SystemId[];
  requireDiagnosis: boolean;
  requireTestRun: boolean;
  unlock?: { jobs?: string[]; rep?: number };
  setup?: (v: VehicleState) => void;
  partsHint: string[];
  mileage: number;
}

const ageCar = (v: VehicleState, k = 1) => {
  const air = partIn(v, 'fuel.air_element'); if (air) air.vars.clog = 0.25 * k;
  for (const w of ['whl.FL', 'whl.FR', 'whl.RL', 'whl.RR']) { const p = partIn(v, w); if (p) { p.vars.tread = 5.2 - k * 0.4; p.flags.push('dirty'); } }
  const disc = partIn(v, 'brk.disc_FL'); if (disc) disc.vars.thickness = 12.1;
  const disc2 = partIn(v, 'brk.disc_FR'); if (disc2) disc2.vars.thickness = 12.05;
  const pads = partIn(v, 'brk.pads_FL'); if (pads) pads.vars.thickness = 6.2;
  const pads2 = partIn(v, 'brk.pads_FR'); if (pads2) pads2.vars.thickness = 5.9;
  const b = partIn(v, 'elec.battery'); if (b) b.vars.age = 3;
  v.oil.comp = { oil_20w50_used: 0.6, oil_20w50: 7.3 };
};

export const JOBS: JobDef[] = [
  {
    id: 't1_service', tier: 1, title: 'Annual service — oil & filter', customer: 'Mrs. Hartley (retired GP)',
    complaint: '"It\'s been sitting in the garage most of the year and hasn\'t had its oil changed for a long while. Could you do an oil and filter change and give it a once-over?"',
    requests: ['Change engine oil and renew the filter element', 'General inspection — report anything you find'],
    faults: ['oil_service_due'], bookHours: 1.2, procedures: ['oil_change'], skills: ['lubrication'],
    requireDiagnosis: false, requireTestRun: true, partsHint: ['oil_20w50_5l', 'oil_20w50_5l', 'filter_kit', 'washer_drain'], mileage: 48210,
    setup: (v) => { ageCar(v, 1); v.oil.comp = { oil_20w50_used: 7.25 }; },
  },
  {
    id: 't1_nostart', tier: 1, title: 'Reluctant starter', customer: 'Mr. Okafor (architect)',
    complaint: '"Some mornings it turns over really slowly and won\'t fire, then it just clicks. A friend jump-started it on Friday and it\'s been fine-ish since. I don\'t want to be stranded."',
    requests: ['Diagnose and fix the starting problem'],
    faults: ['batt_terminal'], bookHours: 1.0, procedures: ['battery'], skills: ['electrical'],
    requireDiagnosis: true, requireTestRun: true, partsHint: [], mileage: 61320,
    unlock: { jobs: ['t1_service'] }, setup: (v) => ageCar(v, 1),
  },
  {
    id: 't1_misfire', tier: 1, title: 'Lumpy idle', customer: 'Ms. Lindqvist (session musician)',
    complaint: '"It idles roughly and sort of shakes, and it feels flat pulling away. It\'s got worse over the last few hundred miles. Smells a bit rich at the back."',
    requests: ['Find the cause of the rough running and put it right'],
    faults: ['plug_fouled'], bookHours: 1.0, procedures: ['spark_plugs'], skills: ['ignition'],
    requireDiagnosis: true, requireTestRun: true, partsHint: ['plug_n5'], mileage: 55870,
    unlock: { jobs: ['t1_service'] }, setup: (v) => ageCar(v, 1.5),
  },
  {
    id: 't1_hot', tier: 1, title: 'Temperature creeping up', customer: 'Mr. & Mrs. Achebe',
    complaint: '"Sitting in traffic last weekend the temperature needle went well past normal. There\'s sometimes a sweet smell. We topped it up with water from the kitchen tap — was that okay?"',
    requests: ['Diagnose the overheating', 'Restore the coolant to specification'],
    faults: ['hose_clip'], bookHours: 1.0, procedures: ['coolant'], skills: ['cooling'],
    requireDiagnosis: true, requireTestRun: true, partsHint: ['coolant_premix_5l'], mileage: 72400,
    unlock: { jobs: ['t1_service'] },
    setup: (v) => { ageCar(v, 1); },
  },
  {
    id: 't1_charge', tier: 1, title: 'Flat battery again', customer: 'Dr. Ferreira (physicist)',
    complaint: '"The battery keeps going flat if I only do short runs. The ammeter needle barely moves to the charge side at idle. New battery last year."',
    requests: ['Find out why the battery is not being kept charged'],
    faults: ['slack_belt'], bookHours: 0.9, procedures: ['belt', 'battery'], skills: ['electrical'],
    requireDiagnosis: true, requireTestRun: true, partsHint: ['fan_belt'], mileage: 39900,
    unlock: { jobs: ['t1_nostart'] }, setup: (v) => ageCar(v, 0.8),
  },
  {
    id: 't1_horn', tier: 1, title: 'Silent horn', customer: 'Mr. Pemberton (MOT next week)',
    complaint: '"The horn has stopped working altogether. Everything else seems fine. It needs to work for the MOT."',
    requests: ['Repair the horn'],
    faults: ['horn_fuse'], bookHours: 0.5, procedures: ['fuse'], skills: ['electrical'],
    requireDiagnosis: true, requireTestRun: false, partsHint: ['fuse_50a'], mileage: 83010,
    unlock: { jobs: ['t1_service'] }, setup: (v) => ageCar(v, 1.2),
  },
  {
    id: 't1_pull', tier: 1, title: 'Pulls to the left', customer: 'Miss Adeyemi',
    complaint: '"Since last week the car pulls to the left and the steering feels heavy. I think I clipped a kerb? Can you have a look before my trip?"',
    requests: ['Find the cause of the pulling', 'Set all tyres to the correct pressure'],
    faults: ['puncture_fl'], bookHours: 0.6, procedures: ['wheel_change'], skills: ['wheels'],
    requireDiagnosis: true, requireTestRun: false, partsHint: [], mileage: 29400,
    unlock: { jobs: ['t1_service'] }, setup: (v) => ageCar(v, 0.6),
  },
  {
    id: 't2_headgasket', tier: 2, title: 'White smoke & vanishing coolant', customer: 'Mr. Delacroix (vintage rally entrant)',
    complaint: '"After it boiled over on a hill climb it\'s never been right. Lumpy on tick-over, clouds of white smoke that smell sweet, and I\'m topping up the coolant every week."',
    requests: ['Diagnose and repair', 'Return it running smoothly with no coolant loss'],
    faults: ['head_gasket'], bookHours: 7, procedures: ['head_gasket'], skills: ['engine', 'cooling'],
    requireDiagnosis: true, requireTestRun: true, partsHint: ['head_gasket', 'coolant_premix_5l'], mileage: 66120,
    setup: (v) => ageCar(v, 1.3),
  },
  {
    id: 't2_knock', tier: 2, title: 'Knocking from the bottom end', customer: 'Ms. Okonkwo (bought it at auction)',
    complaint: '"There\'s a deep knock that gets louder when I accelerate, and the oil-pressure gauge drops right down when it\'s hot at idle. The seller said it \'just needs a service\'. Can you find out what\'s really going on and fix it properly?"',
    requests: ['Diagnose the knock', 'Rebuild the bottom end as required', 'Refit, refill and road-ready'],
    faults: ['bearing_knock'], bookHours: 18, procedures: ['engine_removal', 'bottom_end'], skills: ['engine', 'lubrication'],
    requireDiagnosis: true, requireTestRun: true, partsHint: ['main_bearings_010', 'rod_bearings_010', 'oil_20w50_5l', 'filter_kit', 'coolant_premix_5l'], mileage: 91450,
    unlock: { jobs: ['t2_headgasket'] }, setup: (v) => ageCar(v, 1.6),
  },
];

export const JOB_BY_ID = Object.fromEntries(JOBS.map((j) => [j.id, j]));
export const LABOUR_RATE = 38; // £/h book time
