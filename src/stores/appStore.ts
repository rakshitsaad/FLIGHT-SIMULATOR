/** UI / session state. High-frequency simulation data never goes through here. */
import { create } from 'zustand';
import { loadPrefs, savePrefs } from '../persistence/prefs';
import type { AircraftId, CameraMode, LandingReport } from '../types';

export type Screen = 'menu' | 'hangar' | 'aircontrol' | 'map' | 'history' | 'settings' | 'flight' | 'replay';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'warn' | 'bad';
  until: number;
}

interface Session {
  aircraftId: AircraftId;
  spawnId: string;
}

interface AppState extends Session {
  screen: Screen;
  /** Where "back" from a sub-screen returns to. */
  returnTo: Screen;
  paused: boolean;
  camera: CameraMode;
  panel: null | 'weather' | 'experiment';
  help: boolean;
  landing: LandingReport | null;
  crash: string | null;
  toasts: Toast[];
  /** True while the terrain around the spawn point is still streaming in. */
  loading: boolean;
  /** Academy lesson running in the current flight. */
  academy: boolean;
  webglError: string | null;

  go: (screen: Screen, returnTo?: Screen) => void;
  setSession: (patch: Partial<Session>) => void;
  set: (patch: Partial<Omit<AppState, 'go' | 'set' | 'toast' | 'setSession'>>) => void;
  toast: (text: string, kind?: Toast['kind'], seconds?: number) => void;
}

const session = loadPrefs<Session>('session', { aircraftId: 'trainer', spawnId: 'aia' });
let toastId = 1;

export const useApp = create<AppState>((set, get) => ({
  ...session,
  screen: 'menu',
  returnTo: 'menu',
  paused: false,
  camera: 'chase',
  panel: null,
  help: false,
  landing: null,
  crash: null,
  toasts: [],
  loading: false,
  academy: false,
  webglError: null,

  go: (screen, returnTo) => set({ screen, returnTo: returnTo ?? (get().screen === screen ? get().returnTo : get().screen) }),
  setSession: (patch) => {
    set(patch);
    const s = get();
    savePrefs('session', { aircraftId: s.aircraftId, spawnId: s.spawnId });
  },
  set: (patch) => set(patch),
  toast: (text, kind = 'info', seconds = 3.5) => {
    const now = performance.now();
    const toasts = get()
      .toasts.filter((t) => t.until > now && t.text !== text)
      .slice(-3);
    toasts.push({ id: toastId++, text, kind, until: now + seconds * 1000 });
    set({ toasts });
  },
}));
