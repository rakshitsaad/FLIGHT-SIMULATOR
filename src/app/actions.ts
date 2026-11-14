/** High-level game flow: starting flights, replays, returning to the menu. */
import { audio } from '../audio/AudioEngine';
import { worldRef } from '../game/engine/GameCanvas';
import { sim } from '../game/engine/Simulation';
import { getFlight, saveFlight } from '../persistence/db';
import { useApp, type Screen } from '../stores/appStore';
import { handSettingsFrom, useSettings } from '../stores/settingsStore';
import type { AircraftId, FlightRecord } from '../types';
import { vision } from '../vision/VisionService';
import { controls } from './ControlRouter';

export function applyVisionSettings(): void {
  const s = useSettings.getState();
  vision.configure(handSettingsFrom(s), { delegate: s.visionDelegate, useWorker: s.visionWorker, fps: s.visionFps });
}

export function applyAudioSettings(): void {
  const s = useSettings.getState();
  audio.setVolumes({ master: s.masterVolume, engine: s.engineVolume, ambience: s.ambienceVolume, muted: s.muted });
}

export function startFlight(opts: { aircraftId?: AircraftId; spawnId?: string; experiment?: boolean; academy?: boolean } = {}): void {
  const app = useApp.getState();
  const settings = useSettings.getState();
  const aircraftId = opts.aircraftId ?? app.aircraftId;
  const spawnId = opts.academy ? 'aia' : (opts.spawnId ?? app.spawnId);
  app.setSession({ aircraftId: opts.academy ? 'trainer' : aircraftId, spawnId });
  audio.unlock();
  applyAudioSettings();
  void sim.initCollision();
  sim.start(opts.academy ? 'trainer' : aircraftId, spawnId, { autoTrim: settings.autoTrim, autoStart: settings.autoStart, stallProtection: settings.stallProtection });
  controls.syncThrottle(sim.state.throttle);
  worldRef.current?.rig.snap();
  app.set({
    screen: 'flight',
    returnTo: 'menu',
    paused: false,
    landing: null,
    crash: null,
    camera: settings.defaultCamera,
    loading: true,
    panel: opts.experiment ? 'experiment' : null,
    academy: !!opts.academy,
    help: false,
  });
  if (settings.handControl) void vision.start();
  if (!settings.firstRunDone) settings.set({ firstRunDone: true });
}

export function respawn(): void {
  const app = useApp.getState();
  sim.respawn();
  controls.syncThrottle(sim.state.throttle);
  worldRef.current?.rig.snap();
  app.set({ landing: null, crash: null, paused: false, loading: true });
}

export function exitToMenu(): void {
  const app = useApp.getState();
  sim.stop();
  sim.preview(app.aircraftId, app.spawnId);
  worldRef.current?.rig.snap();
  app.set({ screen: 'menu', returnTo: 'menu', paused: false, landing: null, crash: null, panel: null, academy: false, loading: false });
}

/** Leave a sub-screen. */
export function goBack(): void {
  const app = useApp.getState();
  const to: Screen = app.returnTo === app.screen ? 'menu' : app.returnTo;
  if (to === 'menu') {
    if (sim.mode !== 'idle') exitToMenu();
    else app.set({ screen: 'menu' });
  } else app.set({ screen: to });
}

export async function openReplay(source: string | FlightRecord): Promise<boolean> {
  const rec = typeof source === 'string' ? await getFlight(source) : source;
  if (!rec || rec.frames.length < 2) return false;
  audio.unlock();
  sim.startReplay(rec);
  worldRef.current?.rig.snap();
  useApp.getState().set({ screen: 'replay', returnTo: 'history', paused: false, camera: 'chase', landing: null, crash: null, panel: null, loading: true, academy: false });
  return true;
}

let wired = false;

/** One-time subscriptions that connect the simulation to the UI, storage and audio. */
export function wireApp(): void {
  if (wired) return;
  wired = true;
  audio.attach(sim);
  applyVisionSettings();
  useSettings.subscribe(() => {
    applyVisionSettings();
    applyAudioSettings();
  });
  vision.controller.onGesture = () => audio.gestureTick();
  sim.events.on((e) => {
    const app = useApp.getState();
    switch (e.type) {
      case 'landing':
        app.set({ landing: e.report });
        break;
      case 'crash':
        app.set({ crash: e.cause, landing: null });
        break;
      case 'liftoff':
        app.set({ landing: null });
        break;
      case 'region':
        app.toast(`Entering ${e.region.toUpperCase().replace('OPENSKY', 'OPEN SKY')}`, 'info', 4);
        break;
      case 'gear':
        app.toast(e.down ? 'Landing gear DOWN' : 'Landing gear UP', 'info', 2);
        break;
      case 'flaps':
        app.toast(`Flaps ${e.notch === 0 ? 'UP' : Math.round(sim.spec.flapNotches[e.notch] * 30) + '°'}`, 'info', 2);
        break;
      case 'autopilot':
        app.toast(e.on ? 'Autopilot ON — holding heading & altitude' : 'Autopilot OFF', e.on ? 'good' : 'info', 2.5);
        break;
      case 'engineStart':
        app.toast('Engine running', 'good', 2);
        break;
      case 'engineStop':
        app.toast(`Engine stopped (${e.cause})`, 'warn', 4);
        break;
      case 'damage':
        app.toast(`Damage: ${e.cause}`, 'bad', 3.5);
        break;
      case 'gate':
        app.toast(`Zephyr Gate ${e.passed} cleared`, 'good', 2.5);
        break;
      case 'flightSaved':
        void saveFlight(e.record).catch(() => undefined);
        break;
      default:
        break;
    }
  });
}
