/**
 * Orchestrates the vision stack: camera → hand tracker → single-hand
 * controller. Runs entirely in the browser; nothing is uploaded anywhere.
 *
 * The rest of the app talks to this service (and to the controller's
 * FlightInput) — never to MediaPipe directly.
 */
import { kvDelete, kvGet, kvSet } from '../persistence/db';
import type { GestureCalibration, Handedness } from '../types';
import { defaultCalibration, isValidCalibration } from './calibration/calibration';
import { CAMERA_MESSAGES, CameraManager, type CameraState } from './camera/CameraManager';
import { HandTracker, type TrackerOptions, type TrackerState } from './handTracking/HandTracker';
import { SingleHandFlightController, type HandControlSettings } from './SingleHandFlightController';

export interface VisionStatus {
  camera: CameraState;
  cameraMessage: string;
  cameraLabel: string;
  tracker: TrackerState;
  backend: string;
  trackerError: string;
  /** Hand-tracking results per second. */
  fps: number;
  inferMs: number;
  /** Mean image brightness 0..255, -1 unknown. */
  brightness: number;
  lowLight: boolean;
  calibrated: boolean;
  running: boolean;
}

const CAL_KEY = 'calibration';

export class VisionService {
  readonly camera = new CameraManager();
  readonly tracker = new HandTracker();
  readonly controller = new SingleHandFlightController();
  readonly status: VisionStatus = {
    camera: 'idle',
    cameraMessage: CAMERA_MESSAGES.idle,
    cameraLabel: '',
    tracker: 'idle',
    backend: '',
    trackerError: '',
    fps: 0,
    inferMs: 0,
    brightness: -1,
    lowLight: false,
    calibrated: false,
    running: false,
  };
  private listeners = new Set<(s: VisionStatus) => void>();
  private options: TrackerOptions = { delegate: 'GPU', useWorker: true, fps: 24 };
  private statTimer: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<boolean> | null = null;
  private calibrationLoaded = false;

  constructor() {
    this.tracker.onResult = (hand, _ts) => {
      this.controller.processHand(hand, this.camera.aspect, performance.now());
    };
    this.tracker.onInfo = () => this.publish();
  }

  subscribe(fn: (s: VisionStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private publish(): void {
    const s = this.status;
    s.camera = this.camera.state;
    s.cameraMessage = this.camera.error || CAMERA_MESSAGES[this.camera.state];
    s.cameraLabel = this.camera.deviceLabel;
    s.tracker = this.tracker.info.state;
    s.backend = this.tracker.info.backend;
    s.trackerError = this.tracker.info.error;
    s.fps = this.tracker.info.fps;
    s.inferMs = this.tracker.info.inferMs;
    s.brightness = this.camera.brightness;
    s.lowLight = this.camera.brightness >= 0 && this.camera.brightness < 42;
    s.calibrated = this.controller.calibrated;
    s.running = this.camera.state === 'live' && this.tracker.info.state === 'ready';
    const snapshot = { ...s };
    for (const fn of this.listeners) fn(snapshot);
  }

  configure(hand: HandControlSettings, tracker: TrackerOptions): void {
    const handChanged = this.controller.settings.hand !== hand.hand;
    this.controller.settings = { ...hand };
    this.controller.applySettings();
    if (handChanged && !this.controller.calibrated) this.controller.calibration = defaultCalibration(hand.hand, this.camera.aspect);
    const restart = this.status.running && (tracker.delegate !== this.options.delegate || tracker.useWorker !== this.options.useWorker);
    this.options = { ...tracker };
    this.tracker.setFps(tracker.fps);
    if (restart) void this.tracker.start(this.camera.video, this.options).then(() => this.publish());
  }

  /** Ask for the webcam and start hand tracking. Resolves true when both are live. */
  start(): Promise<boolean> {
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<boolean> {
    await this.loadCalibration();
    if (this.status.running) return true;
    this.publish();
    const req = this.camera.start();
    this.publish();
    const cam = await req;
    this.publish();
    if (cam !== 'live') return false;
    this.controller.setActive(true);
    await this.tracker.start(this.camera.video, this.options);
    if (!this.statTimer) {
      this.statTimer = setInterval(() => {
        this.camera.measureBrightness();
        this.publish();
      }, 500);
    }
    this.publish();
    return this.status.running;
  }

  stop(): void {
    this.tracker.stop();
    this.camera.stop();
    this.controller.setActive(false);
    if (this.statTimer) clearInterval(this.statTimer);
    this.statTimer = null;
    this.publish();
  }

  async loadCalibration(): Promise<GestureCalibration | null> {
    if (this.calibrationLoaded) return this.controller.calibrated ? this.controller.calibration : null;
    this.calibrationLoaded = true;
    try {
      const c = await kvGet<GestureCalibration>(CAL_KEY);
      if (isValidCalibration(c)) {
        this.controller.setCalibration(c, true);
        this.publish();
        return c;
      }
    } catch {
      /* no stored calibration */
    }
    return null;
  }

  async saveCalibration(c: GestureCalibration): Promise<void> {
    this.controller.setCalibration(c, true);
    this.calibrationLoaded = true;
    this.publish();
    try {
      await kvSet(CAL_KEY, c);
    } catch {
      /* persistence unavailable: calibration lasts for this session */
    }
  }

  async clearCalibration(hand: Handedness): Promise<void> {
    this.controller.setCalibration(defaultCalibration(hand, this.camera.aspect), false);
    this.publish();
    try {
      await kvDelete(CAL_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const vision = new VisionService();
