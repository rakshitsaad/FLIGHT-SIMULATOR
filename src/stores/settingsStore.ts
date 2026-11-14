/** Player preferences, persisted to localStorage. */
import { create } from 'zustand';
import { loadPrefs, savePrefs } from '../persistence/prefs';
import type { CameraMode, GraphicsPreset, Handedness } from '../types';
import { DEFAULT_HAND_SETTINGS, type HandControlSettings } from '../vision/SingleHandFlightController';

export interface Settings {
  graphics: GraphicsPreset;
  /** 0..1 */
  masterVolume: number;
  engineVolume: number;
  ambienceVolume: number;
  muted: boolean;
  units: 'aviation' | 'metric';
  defaultCamera: CameraMode;

  /* hand control */
  handControl: boolean;
  hand: Handedness;
  enforceHand: boolean;
  sensitivity: number;
  yawSensitivity: number;
  deadZone: number;
  yawDeadZone: number;
  smoothing: number;
  expo: number;
  invertPitch: boolean;
  fistPauseSeconds: number;
  gestures: boolean;
  /** Target inference rate. */
  visionFps: number;
  visionDelegate: 'GPU' | 'CPU';
  visionWorker: boolean;
  showHandPreview: boolean;

  /* assists */
  autoTrim: boolean;
  autoStart: boolean;
  /** Stick pusher: holding the stick back gives maximum lift instead of a stall. */
  stallProtection: boolean;
  /** Hand mode: hold the wheel brakes while the hand is fully open on the ground. */
  autoBrake: boolean;
  /** Level the aircraft if hand tracking is lost in the air. */
  lostHandAssist: boolean;

  firstRunDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'medium',
  masterVolume: 0.8,
  engineVolume: 0.8,
  ambienceVolume: 0.7,
  muted: false,
  units: 'aviation',
  defaultCamera: 'chase',
  handControl: false,
  hand: DEFAULT_HAND_SETTINGS.hand,
  enforceHand: DEFAULT_HAND_SETTINGS.enforceHand,
  sensitivity: DEFAULT_HAND_SETTINGS.sensitivity,
  yawSensitivity: DEFAULT_HAND_SETTINGS.yawSensitivity,
  deadZone: DEFAULT_HAND_SETTINGS.deadZone,
  yawDeadZone: DEFAULT_HAND_SETTINGS.yawDeadZone,
  smoothing: DEFAULT_HAND_SETTINGS.smoothing,
  expo: DEFAULT_HAND_SETTINGS.expo,
  invertPitch: false,
  fistPauseSeconds: 2,
  gestures: true,
  visionFps: 24,
  visionDelegate: 'GPU',
  visionWorker: true,
  showHandPreview: true,
  autoTrim: true,
  autoStart: true,
  stallProtection: true,
  autoBrake: true,
  lostHandAssist: true,
  firstRunDone: false,
};

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const KEY = 'settings';

function pick(s: SettingsStore): Settings {
  const { set: _s, reset: _r, ...rest } = s;
  return rest;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...loadPrefs(KEY, DEFAULT_SETTINGS),
  set: (patch) => {
    set(patch);
    savePrefs(KEY, pick(get()));
  },
  reset: () => {
    set({ ...DEFAULT_SETTINGS, firstRunDone: get().firstRunDone });
    savePrefs(KEY, pick(get()));
  },
}));

export function handSettingsFrom(s: Settings): HandControlSettings {
  return {
    hand: s.hand,
    enforceHand: s.enforceHand,
    sensitivity: s.sensitivity,
    yawSensitivity: s.yawSensitivity,
    deadZone: s.deadZone,
    yawDeadZone: s.yawDeadZone,
    smoothing: s.smoothing,
    expo: s.expo,
    invertPitch: s.invertPitch,
    fistPauseSeconds: s.fistPauseSeconds,
    gestures: s.gestures,
  };
}

export interface GraphicsConfig {
  viewChunks: number;
  lodSegments: [number, number, number, number];
  treeLods: number;
  treeSpacing: number;
  shadows: boolean;
  shadowMap: number;
  dpr: number;
  clouds: number;
  rain: number;
  antialias: boolean;
}

export const GRAPHICS: Record<GraphicsPreset, GraphicsConfig> = {
  low: { viewChunks: 7, lodSegments: [64, 32, 16, 8], treeLods: 1, treeSpacing: 64, shadows: false, shadowMap: 1024, dpr: 1, clouds: 60, rain: 2500, antialias: false },
  medium: { viewChunks: 10, lodSegments: [96, 48, 24, 12], treeLods: 1, treeSpacing: 46, shadows: true, shadowMap: 2048, dpr: 1.5, clouds: 110, rain: 5000, antialias: true },
  high: { viewChunks: 13, lodSegments: [128, 64, 32, 16], treeLods: 2, treeSpacing: 38, shadows: true, shadowMap: 4096, dpr: 2, clouds: 170, rain: 8000, antialias: true },
};
