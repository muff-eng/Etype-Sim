/** Shared simulation types. The simulation layer never imports three.js — conditions live independently of meshes. */

export type SystemId =
  | 'body' | 'engine' | 'lubrication' | 'cooling' | 'fuel' | 'ignition' | 'electrical'
  | 'transmission' | 'suspension' | 'steering' | 'brakes' | 'wheels' | 'interior' | 'exhaust';

export const SYSTEM_LABEL: Record<SystemId, string> = {
  body: 'Body', engine: 'Engine', lubrication: 'Lubrication', cooling: 'Cooling', fuel: 'Fuel & Induction',
  ignition: 'Ignition', electrical: 'Electrical', transmission: 'Transmission & Final Drive', suspension: 'Suspension',
  steering: 'Steering', brakes: 'Brakes', wheels: 'Wheels & Tyres', interior: 'Interior', exhaust: 'Exhaust',
};

export type PartFlag =
  | 'corroded' | 'contaminated' | 'leaking' | 'fouled' | 'oily' | 'damaged' | 'broken' | 'cracked'
  | 'incorrect' | 'misadjusted' | 'crushed' | 'rounded' | 'blown' | 'worn' | 'dirty' | 'seized'
  | 'hardened' | 'glazed' | 'punctured' | 'greased' | 'chipped';

export const FLAG_LABEL: Record<PartFlag, string> = {
  corroded: 'Corroded', contaminated: 'Contaminated', leaking: 'Leaking', fouled: 'Fouled', oily: 'Oily deposits',
  damaged: 'Damaged', broken: 'Broken', cracked: 'Cracked', incorrect: 'Incorrect part', misadjusted: 'Incorrectly adjusted',
  crushed: 'Crushed (used)', rounded: 'Rounded flats', blown: 'Blown', worn: 'Worn', dirty: 'Dirty', seized: 'Seized',
  hardened: 'Hardened / perished', glazed: 'Glazed', punctured: 'Punctured', greased: 'Protected (greased)', chipped: 'Chipped',
};

export type PartOrigin = 'factory' | 'new' | 'used' | 'refurb' | 'aftermarket';
export type PartLocation = 'vehicle' | 'tray' | 'stock' | 'scrap';

export interface PartState {
  uid: string;
  def: string;
  condition: number;               // 0..1
  flags: PartFlag[];
  vars: Record<string, number>;    // hidden physical variables (gap_mm, charge, pressure_psi, ...)
  known: { inspected?: boolean; measured: Record<string, number> };
  origin: PartOrigin;
  location: PartLocation;
  slot?: string;
}

export interface SlotState {
  part: string | null;
  turnsIn: number;       // thread engagement
  torque: number;        // Nm held at seat
  handStarted: boolean;
  crossThreaded: boolean;
  threadDamage: number;  // 0 = ok, 1 = stripped (host thread)
  vars: Record<string, number>;
}

export type Corner = 'FL' | 'FR' | 'RL' | 'RR';
export const CORNERS: Corner[] = ['FL', 'FR', 'RL', 'RR'];

export interface CornerSupport {
  height: number;      // m lift of body at this corner above ride height
  jack: boolean;       // floor jack under this corner
  stand: number;       // 0 = no stand, else stand head height (m lift it holds)
}

export type ConditionLabel = 'New' | 'Excellent' | 'Good' | 'Used' | 'Worn' | 'Severely worn' | 'Damaged' | 'Broken';
export function conditionLabel(c: number, flags: PartFlag[] = []): ConditionLabel {
  if (flags.includes('broken') || flags.includes('blown')) return 'Broken';
  if (flags.includes('damaged') || flags.includes('cracked')) return 'Damaged';
  if (c >= 0.98) return 'New';
  if (c >= 0.88) return 'Excellent';
  if (c >= 0.72) return 'Good';
  if (c >= 0.5) return 'Used';
  if (c >= 0.3) return 'Worn';
  if (c > 0.08) return 'Severely worn';
  return 'Broken';
}

export type AssistLevel = 'beginner' | 'experienced' | 'expert' | 'master';
export const ASSIST_LABEL: Record<AssistLevel, string> = {
  beginner: 'Beginner', experienced: 'Experienced', expert: 'Expert', master: 'Master Mechanic',
};
