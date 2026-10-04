/**
 * Save system. GameState is plain JSON; storage goes through an adapter so a cloud backend can be
 * added later without touching game code.
 */
import type { GameState } from '../game/state';
import { SAVE_VERSION } from '../game/state';
import { createVehicle } from '../sim/vehicle';
import { SLOT_LIST } from '../data/slots';

export interface StorageAdapter {
  list(): Promise<{ id: string; savedAt: number; label: string }[]>;
  load(id: string): Promise<GameState | null>;
  save(id: string, state: GameState, label: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const PREFIX = 'cte-workshop:';

export class LocalStorageAdapter implements StorageAdapter {
  async list() {
    const out: { id: string; savedAt: number; label: string }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (!k.startsWith(PREFIX + 'meta:')) continue;
        const meta = JSON.parse(localStorage.getItem(k) ?? '{}');
        out.push({ id: k.slice((PREFIX + 'meta:').length), savedAt: meta.savedAt ?? 0, label: meta.label ?? '' });
      }
    } catch { /* storage unavailable */ }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }
  async load(id: string) {
    try {
      const raw = localStorage.getItem(PREFIX + id);
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch { return null; }
  }
  async save(id: string, state: GameState, label: string) {
    try {
      localStorage.setItem(PREFIX + id, JSON.stringify(state));
      localStorage.setItem(PREFIX + 'meta:' + id, JSON.stringify({ savedAt: Date.now(), label }));
    } catch (e) { console.warn('save failed', e); throw e; }
  }
  async remove(id: string) {
    try { localStorage.removeItem(PREFIX + id); localStorage.removeItem(PREFIX + 'meta:' + id); } catch { /* ignore */ }
  }
}

/** Upgrades older saves; also back-fills any slots added to the vehicle database since. */
export function migrate(s: GameState): GameState {
  if (!s || typeof s !== 'object') throw new Error('bad save');
  if (!s.version) s.version = 1;
  const fresh = createVehicle();
  for (const def of SLOT_LIST) {
    if (!s.vehicle.slots[def.id]) {
      s.vehicle.slots[def.id] = fresh.slots[def.id];
      const uid = fresh.slots[def.id].part;
      if (uid) s.vehicle.parts[uid] = fresh.parts[uid];
    }
  }
  s.version = SAVE_VERSION;
  return s;
}

export const storage: StorageAdapter = new LocalStorageAdapter();
