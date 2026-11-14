/**
 * Merges every input device into the single normalised FlightInput the
 * simulation consumes:
 *
 *   webcam hand (SingleHandFlightController)  ─┐
 *                                              ├─▶ FlightInput ─▶ Simulation
 *   keyboard fallback                         ─┘
 *
 * Also owns the safety behaviour that needs to know about both sides:
 * auto wheel-brake in hand mode, and the level-flight assist that takes
 * over when hand tracking is lost in the air.
 */
import { sim } from '../game/engine/Simulation';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import type { CameraMode, FlightCommand, FlightInput } from '../types';
import { vision } from '../vision/VisionService';

const CAMERAS: CameraMode[] = ['chase', 'cockpit', 'cinematic', 'instruments'];
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class ControlRouter {
  readonly current: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, source: 'keyboard' };
  /** True when the hand is the active primary control this frame. */
  handActive = false;
  /** Level-flight assist currently engaged because the hand was lost. */
  assist = false;
  /** Extra listeners for edge commands (HUD flashes, academy lessons). */
  onCommand: (cmd: FlightCommand, source: 'hand' | 'keyboard') => void = () => {};
  private keys = new Set<string>();
  private kb = { pitch: 0, roll: 0, yaw: 0 };
  private kbThrottle = 0;
  private attached = false;
  private lostTimer = 0;

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    vision.controller.onCommand = (cmd) => this.command(cmd, 'hand');
    sim.inputSource = () => this.current;
  }

  detach(): void {
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onBlur = () => this.keys.clear();

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const app = useApp.getState();
    const flying = app.screen === 'flight';
    const replay = app.screen === 'replay';
    if (!flying && !replay) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'PageUp', 'PageDown', 'Backspace'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Escape':
      case 'KeyP':
        if (flying) this.command('pause', 'keyboard');
        break;
      case 'KeyC':
        app.set({ camera: CAMERAS[(CAMERAS.indexOf(app.camera) + 1) % CAMERAS.length] });
        break;
      case 'Digit1':
        app.set({ camera: 'cockpit' });
        break;
      case 'Digit2':
        app.set({ camera: 'chase' });
        break;
      case 'Digit3':
        app.set({ camera: 'cinematic' });
        break;
      case 'Digit4':
        app.set({ camera: 'instruments' });
        break;
      case 'KeyM':
        useSettings.getState().set({ muted: !useSettings.getState().muted });
        break;
      default:
        break;
    }
    if (!flying || app.paused) return;
    switch (e.code) {
      case 'KeyG':
        this.command('toggleGear', 'keyboard');
        break;
      case 'KeyF':
        this.command(e.shiftKey ? 'flapsUp' : 'flapsDown', 'keyboard');
        break;
      case 'KeyR':
        this.command('flapsUp', 'keyboard');
        break;
      case 'KeyZ':
        this.command('toggleAutopilot', 'keyboard');
        break;
      case 'KeyI':
        this.command('toggleEngine', 'keyboard');
        break;
      case 'Backspace':
        this.command('resetAircraft', 'keyboard');
        break;
      case 'KeyH': {
        const s = useSettings.getState();
        s.set({ handControl: !s.handControl });
        app.toast(s.handControl ? 'Hand control off — keyboard only' : 'Hand control on', 'info');
        if (!s.handControl) void vision.start();
        break;
      }
      case 'KeyX':
        if (vision.controller.recenter()) app.toast('Hand re-centred', 'good');
        break;
      case 'Tab':
      case 'KeyN':
        app.set({ panel: app.panel ? null : 'weather' });
        break;
      case 'KeyK':
        app.set({ help: !app.help });
        break;
      default:
        break;
    }
  };

  /** Handle an edge-triggered command from any device. */
  command(cmd: FlightCommand, source: 'hand' | 'keyboard'): void {
    const app = useApp.getState();
    this.onCommand(cmd, source);
    if (cmd === 'pause') {
      if (app.screen !== 'flight' || sim.mode === 'crashed') return;
      app.set({ paused: !app.paused });
      if (source === 'hand') app.toast(app.paused ? 'Resumed by fist hold' : 'Emergency pause (fist hold)', 'warn');
      return;
    }
    if (app.paused || app.screen !== 'flight') return;
    if (cmd === 'resetAircraft') {
      app.set({ landing: null, crash: null });
    }
    sim.command(cmd);
  }

  /** Run once per rendered frame, before the simulation advances. */
  frame(dt: number): void {
    const settings = useSettings.getState();
    const app = useApp.getState();
    const out = this.current;
    const k = this.keys;
    const flying = app.screen === 'flight' && !app.paused;

    // ---- keyboard axes (smoothed so taps are gentle and holds are full)
    const tp = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    const tr = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ty = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const ease = (cur: number, target: number) => {
      const rate = (target === 0 ? 5.5 : 3.2) * dt;
      return cur + clamp(target - cur, -rate, rate);
    };
    const kb = this.kb;
    kb.pitch = flying ? ease(kb.pitch, tp) : 0;
    kb.roll = flying ? ease(kb.roll, tr) : 0;
    kb.yaw = flying ? ease(kb.yaw, ty) : 0;
    const up = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Equal') || k.has('PageUp') || k.has('NumpadAdd');
    const down = k.has('ControlLeft') || k.has('ControlRight') || k.has('Minus') || k.has('PageDown') || k.has('NumpadSubtract');
    if (flying) this.kbThrottle = clamp(this.kbThrottle + ((up ? 1 : 0) - (down ? 1 : 0)) * 0.55 * dt, 0, 1);
    const kbBrake = k.has('Space') || k.has('KeyB') ? 1 : 0;

    // ---- hand
    const ctl = vision.controller;
    const handOn = settings.handControl && vision.status.running;
    const hi = ctl.update(dt, performance.now());
    const tracking = handOn && ctl.isTracking;
    this.handActive = tracking;
    const s = sim.state;

    if (handOn) {
      out.pitch = clamp(hi.pitch + kb.pitch, -1, 1);
      out.roll = clamp(hi.roll + kb.roll, -1, 1);
      out.yaw = clamp(hi.yaw + kb.yaw, -1, 1);
      if (tracking) {
        out.throttle = hi.throttle;
        this.kbThrottle = hi.throttle;
      } else {
        // hand not visible: the last throttle is held, the keyboard may trim it
        if (up || down) ctl.syncThrottle(this.kbThrottle);
        else this.kbThrottle = hi.throttle;
        out.throttle = this.kbThrottle;
      }
      const usingKeys = kb.pitch !== 0 || kb.roll !== 0 || kb.yaw !== 0;
      out.source = tracking ? (usingKeys ? 'mixed' : 'hand') : 'keyboard';

      // one-hand wheel brakes: an open hand (idle throttle) on the ground holds the brakes
      let brake = kbBrake;
      if (settings.autoBrake && s.onGround && !s.onWater) {
        if (tracking && hi.throttle < 0.04) brake = 1;
        if (!tracking && ctl.snapshot.everTracked && sim.model.hasFlown) brake = 1;
      }
      out.brake = brake;

      // tracking lost in the air: hold the aircraft level until the hand is back
      if (flying && sim.mode === 'flying') {
        if (!tracking && ctl.snapshot.everTracked && !s.onGround) this.lostTimer += dt;
        else this.lostTimer = 0;
        if (settings.lostHandAssist && this.lostTimer > 1.2 && !s.autopilot && !usingKeys) {
          sim.model.setAutopilot(true, true);
          this.assist = true;
          app.toast('Hand lost — holding level flight', 'warn', 4);
        }
        if (this.assist && (tracking || usingKeys || !s.autopilot)) {
          if (s.autopilot && sim.model.ap.assist) sim.model.setAutopilot(false, false);
          this.assist = false;
          if (tracking) app.toast('Hand detected — you have control', 'good', 2.5);
        }
      }
    } else {
      out.pitch = kb.pitch;
      out.roll = kb.roll;
      out.yaw = kb.yaw;
      out.throttle = this.kbThrottle;
      // parked with the throttle closed: hold the aircraft still
      out.brake = kbBrake || (s.onGround && !s.onWater && this.kbThrottle < 0.02 && s.groundSpeed < 1.5 ? 1 : 0);
      out.source = 'keyboard';
      ctl.syncThrottle(this.kbThrottle);
      if (this.assist) {
        if (s.autopilot && sim.model.ap.assist) sim.model.setAutopilot(false, false);
        this.assist = false;
      }
      this.lostTimer = 0;
    }
  }

  /** Align the keyboard throttle with a freshly spawned aircraft. */
  syncThrottle(v: number): void {
    this.kbThrottle = v;
    vision.controller.syncThrottle(v);
    this.current.throttle = v;
  }
}

export const controls = new ControlRouter();
