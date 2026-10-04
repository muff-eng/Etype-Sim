import type { AssistLevel, Corner, PartState, SystemId } from '../sim/types';
import type { VehicleState } from '../sim/vehicle';
import type { Composition } from '../data/fluids';

export interface Spill { x: number; z: number; r: number; kind: 'oil' | 'coolant' }

export interface WorkshopState {
  drainPan: { x: number; z: number; comp: Composition };
  jack: { corner: Corner | null };
  stands: Corner[];            // corners that have a stand placed
  standsOwned: number;
  spills: Spill[];
  charger: { connected: boolean; amps: number };
  wrenchError: number;         // torque wrench calibration multiplier (1 = perfect)
  upgrades: string[];
  penetrating: Record<string, number>; // slot → game time applied
}

export interface TestRecord {
  id: string;
  t: number;
  tag: string;
  label: string;
  value: string;
  system?: SystemId;
}

export interface JobState {
  id: string;
  startedAt: number;
  milestones: string[];
  latched: string[];
  tests: TestRecord[];
  violations: string[];
  notes: string;
  diagnosis: string | null;
  diagnosisAt: number | null;
  partsBilled: { def: string; price: number }[];
  replaced: string[];          // slot ids where a part was swapped
  damage: string[];
  spilledL: number;
  fixedAt: Record<string, number>; // fault id → game time first resolved
}

export interface Settings {
  assist: AssistLevel;
  edu: boolean;
  volume: number;
  paint: string;
  timeScale: number;
  quality: 'low' | 'high';
}

export interface Progress {
  skills: Record<SystemId, number>;   // 0..5 per system
  xp: Record<SystemId, number>;
  rep: number;                        // 0..100
  completed: Record<string, { grade: string; pay: number; at: number; quality: number }>;
}

export interface GameState {
  version: number;
  mode: 'menu' | 'tier1' | 'sandbox';
  money: number;
  time: number;                       // game seconds since Day 1 00:00
  vehicle: VehicleState;
  inventory: Record<string, PartState>;
  tools: string[];
  workshop: WorkshopState;
  job: JobState | null;
  settings: Settings;
  progress: Progress;
  log: { t: number; text: string }[];
}

export const SAVE_VERSION = 1;
export const DAY_START = 8 * 3600;
