type Handler<T> = (payload: T) => void;

export interface GameEvents {
  'vehicle:changed': { slot?: string; reason?: string };
  'workshop:changed': {};
  'inventory:changed': {};
  'tools:changed': {};
  'money:changed': { money: number };
  'job:changed': {};
  'notify': { text: string; kind?: 'info' | 'good' | 'warn' | 'bad' };
  'test:recorded': { id: string };
  'selection:changed': { target: PickTarget | null };
  'hover:changed': { target: PickTarget | null };
  'sound': { name: string; gain?: number; rate?: number };
  'engine:event': { name: 'start' | 'stall' | 'backfire' | 'crank' | 'click' | 'catch' };
  'settings:changed': {};
  'ui:open': { panel: string; arg?: unknown };
  'state:loaded': {};
}

export interface PickTarget {
  kind: 'slot' | 'hotspot' | 'equipment' | 'floor' | 'tray';
  id: string;
  point?: [number, number, number];
}

export class EventBus {
  private map = new Map<string, Set<Handler<any>>>();
  on<K extends keyof GameEvents>(ev: K, fn: Handler<GameEvents[K]>): () => void {
    let s = this.map.get(ev);
    if (!s) this.map.set(ev, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit<K extends keyof GameEvents>(ev: K, payload: GameEvents[K]) {
    this.map.get(ev)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(`[event ${ev}]`, e); }
    });
  }
}

export const bus = new EventBus();
export const notify = (text: string, kind: GameEvents['notify']['kind'] = 'info') => bus.emit('notify', { text, kind });
export const sound = (name: string, gain = 1, rate = 1) => bus.emit('sound', { name, gain, rate });
