/**
 * Vehicle-local geometry shared by simulation (drip/drain targets, jack points) and rendering.
 * Axes: +X forward, +Y up, +Z to the car's right (RHD driver side). Origin: ground, mid-wheelbase.
 * Values derive from SPEC.dimensions (wheelbase 2438 mm, track 1270 mm, 185 VR 15 tyres).
 */
import type { Corner } from '../sim/types';

export type V3 = [number, number, number];

export const WHEELBASE = 2.438;
export const TRACK = 1.27;
export const WHEEL_R = 0.343;
export const AXLE_F = WHEELBASE / 2;
export const AXLE_R = -WHEELBASE / 2;

export const WHEEL_POS: Record<Corner, V3> = {
  FL: [AXLE_F, WHEEL_R, -TRACK / 2], FR: [AXLE_F, WHEEL_R, TRACK / 2],
  RL: [AXLE_R, WHEEL_R, -TRACK / 2], RR: [AXLE_R, WHEEL_R, TRACK / 2],
};

/** Engine local frame: origin on crankshaft axis at the block's mid-length. No.1 cylinder at the REAR. */
export const ENGINE_ORIGIN: V3 = [0.97, 0.35, 0];
export const BORE_PITCH = 0.1;
export const cylX = (c: number) => -0.25 + (c - 1) * BORE_PITCH;   // engine-local X of cylinder c (1..6)
export const CRANK_R = 0.053;
export const ROD_L = 0.175;
export const DECK_Y = 0.25;
export const FIRING_ORDER = [1, 5, 3, 6, 2, 4];
/** Crank angle at which each cylinder reaches TDC on its compression stroke (0..720). */
export const TDC_COMP: Record<number, number> = { 1: 0, 5: 120, 3: 240, 6: 360, 2: 480, 4: 600 };

export const eng = (p: V3): V3 => [ENGINE_ORIGIN[0] + p[0], ENGINE_ORIGIN[1] + p[1], ENGINE_ORIGIN[2] + p[2]];

/** Service points (vehicle-local). */
export const POINTS = {
  drainPlug: eng([-0.22, -0.225, 0.02]),
  filterBottom: eng([0.0, -0.19, 0.19]),
  filterHead: eng([0.0, -0.03, 0.19]),
  oilFiller: eng([0.26, 0.475, 0.085]),
  dipstick: eng([0.12, 0.3, -0.19]),
  headerCap: [1.42, 0.69, 0.33] as V3,
  bottomHoseRad: [1.5, 0.27, -0.16] as V3,
  bottomHosePump: eng([0.36, 0.1, -0.06]),
  battery: [0.76, 0.5, 0.44] as V3,
  fusePanel: [0.3, 0.72, 0.0] as V3,
  brakeRes: [0.68, 0.7, 0.26] as V3,
  clutchRes: [0.68, 0.7, 0.16] as V3,
  gbxLevel: [0.3, 0.3, 0.1] as V3,
  diffLevel: [-1.1, 0.33, 0.1] as V3,
};

export const JACK_POINTS: Record<Corner, V3> = {
  FL: [0.74, 0.16, -0.6], FR: [0.74, 0.16, 0.6], RL: [-0.82, 0.16, -0.62], RR: [-0.82, 0.16, 0.62],
};
export const STAND_POINTS: Record<Corner, V3> = {
  FL: [0.6, 0.16, -0.47], FR: [0.6, 0.16, 0.47], RL: [-0.98, 0.16, -0.5], RR: [-0.98, 0.16, 0.5],
};

/** Rigid body pose from corner lift heights: returns a vehicle-local → world point transform. */
export function poseFn(h: Record<Corner, number>) {
  const hF = (h.FL + h.FR) / 2, hR = (h.RL + h.RR) / 2;
  const hLeft = (h.FL + h.RL) / 2, hRight = (h.FR + h.RR) / 2;
  const pitch = Math.atan2(hF - hR, WHEELBASE);
  const roll = Math.atan2(hRight - hLeft, TRACK);
  const y0 = (hF + hR) / 2;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  return {
    pitch, roll, y0,
    apply: (p: V3): V3 => {
      // roll about X (raise +Z side for positive roll), then pitch about Z, then lift
      const y1 = p[1] * cr + p[2] * sr;
      const z1 = -p[1] * sr + p[2] * cr;
      const x2 = p[0] * cp - y1 * sp;
      const y2 = p[0] * sp + y1 * cp;
      return [x2, y2 + y0, z1];
    },
  };
}
