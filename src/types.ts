/**
 * Shared contracts between the three independent halves of SKYBOUND:
 *
 *   vision  ──▶  FlightInput  ──▶  flight engine  ──▶  AircraftState  ──▶  rendering / HUD / audio
 *
 * The vision code never imports the engine and the engine never imports the
 * vision code. They only meet through the types in this file.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/* ------------------------------------------------------------------ vision */

export type Handedness = 'Left' | 'Right';

/**
 * One detected hand: the 21 MediaPipe landmarks.
 * `image` is in normalised, *mirrored* image space: x grows towards the
 * player's right, y grows downwards. `world` is metric (metres), wrist-relative.
 */
export interface HandLandmarks {
  image: Vec3[];
  world: Vec3[];
  /** The player's physical hand (already corrected for camera mirroring). */
  handedness: Handedness;
  /** Detector confidence 0..1. */
  score: number;
  /** performance.now() timestamp of the video frame. */
  timestamp: number;
}

/** Continuous measurements derived from the 21 landmarks. */
export interface HandFeatures {
  palmCenter: Vec2;
  wrist: Vec2;
  /** Wrist → middle knuckle length in aspect-corrected image units. */
  handScale: number;
  /** In-plane wrist rotation, radians. 0 = fingers up, + = clockwise as the player sees it. */
  wristAngle: number;
  /** Curl per finger (thumb, index, middle, ring, pinky), 0 = straight, 1 = fully curled. */
  fingerCurl: [number, number, number, number, number];
  /** Mean extension of the four fingers, 0 = fist, 1 = flat hand. */
  openness: number;
  /** Thumb tip ↔ index tip distance divided by palm size. */
  thumbIndexDistance: number;
  /** Thumb tip ↔ middle finger knuckle distance divided by palm size (thumb tucked detection). */
  thumbTuck: number;
  /** Direction of the thumb in mirrored image space (unit-ish vector, y down). */
  thumbDirection: Vec2;
  /** How far the thumb tip sticks out above every other landmark, as a fraction of the hand's height in the image. */
  thumbProminence: number;
}

export type GestureName = 'pinch' | 'thumbsUp' | 'victory' | 'fist';

export interface GestureState {
  /** Gesture pose currently recognised (after hysteresis), or null. */
  active: GestureName | null;
  /** Progress 0..1 towards confirming the active gesture. */
  progress: number;
  /** Fist-hold progress towards emergency pause, 0..1. */
  fistHold: number;
  /** True while the throttle is frozen because a gesture pose is being formed. */
  throttleFrozen: boolean;
  /** Timestamp of the last fired gesture per type (ms). */
  lastFired: Partial<Record<GestureName, number>>;
}

export interface GestureCalibration {
  version: number;
  hand: Handedness;
  createdAt: number;
  /** Neutral palm centre (mirrored image space). */
  neutral: Vec2;
  /** Palm travel (image units, positive) from neutral to the full-deflection pose. */
  rollLeft: number;
  rollRight: number;
  pitchUp: number;
  pitchDown: number;
  /** Wrist angle at rest and usable travel either way (radians, positive). */
  wristNeutral: number;
  wristCcw: number;
  wristCw: number;
  /** Raw openness measured with a flat hand and with a closed fist. */
  opennessOpen: number;
  opennessFist: number;
  /** Hand scale at calibration distance, used to detect the hand moving closer/further. */
  handScale: number;
  /** Thumb-index distance of a relaxed open hand, for pinch thresholding. */
  pinchOpen: number;
}

export type TrackingStatus = 'off' | 'starting' | 'searching' | 'tracking' | 'lost' | 'wrong-hand' | 'error';

/** Commands that are edge-triggered rather than continuous. */
export type FlightCommand =
  | 'toggleGear'
  | 'flapsDown'
  | 'flapsUp'
  | 'cycleFlaps'
  | 'toggleAutopilot'
  | 'toggleEngine'
  | 'pause'
  | 'resetAircraft';

/* ------------------------------------------------------------------ engine */

/**
 * The normalised control interface between any input device and the flight
 * model. Everything is device-independent.
 */
export interface FlightInput {
  /** -1 (nose down) .. +1 (nose up). */
  pitch: number;
  /** -1 (bank left) .. +1 (bank right). */
  roll: number;
  /** -1 (yaw left) .. +1 (yaw right). */
  yaw: number;
  /** 0 .. 1. */
  throttle: number;
  /** 0 .. 1 wheel brake. */
  brake: number;
  source: 'hand' | 'keyboard' | 'mixed' | 'none';
}

export type AircraftId = 'trainer' | 'sport' | 'turboprop' | 'jet';

export type SurfaceKind = 'asphalt' | 'grass' | 'dirt' | 'sand' | 'rough' | 'water' | 'snow';

export interface AircraftState {
  aircraftId: AircraftId;
  /** World position of the centre of gravity (m). x east, y up, z south. */
  position: Vec3;
  /** Body → world rotation. Body axes: +x right wing, +y up, -z nose. */
  orientation: Quat;
  /** World linear velocity (m/s). */
  velocity: Vec3;
  /** Body-frame angular velocity (rad/s). */
  angularVelocity: Vec3;
  /** World linear acceleration of the last step (m/s²). */
  acceleration: Vec3;

  /** Forces of the last step, body frame, Newtons. */
  thrust: number;
  lift: number;
  drag: number;
  weight: number;
  /** Wind (incl. gusts) at the aircraft, world frame m/s. */
  wind: Vec3;

  /* derived air data */
  airspeed: number; // true airspeed m/s
  indicatedAirspeed: number; // m/s
  groundSpeed: number;
  verticalSpeed: number;
  altitude: number; // MSL m
  altitudeAgl: number; // above terrain/water m
  heading: number; // deg 0..360
  pitch: number; // rad
  bank: number; // rad, + right
  alpha: number; // rad
  beta: number; // rad
  gLoad: number;
  airDensity: number;

  /* configuration */
  throttle: number; // commanded 0..1
  enginePower: number; // spooled 0..1
  engineRunning: boolean;
  rpm: number;
  fuel: number; // kg
  fuelFraction: number;
  flaps: number; // actual 0..1
  flapsNotch: number; // commanded notch index
  gear: number; // 0 up .. 1 down
  gearDown: boolean; // commanded
  brake: number;
  autopilot: boolean;
  /** Control surface positions actually applied, -1..1. */
  elevator: number;
  aileron: number;
  rudder: number;

  /* status */
  onGround: boolean;
  onWater: boolean;
  wheelsOnGround: number;
  surface: SurfaceKind;
  stalled: boolean;
  stallWarning: boolean;
  overspeed: boolean;
  damage: number; // 0..1
  destroyed: boolean;
  /** Seconds since this flight started. */
  time: number;
}

export type WeatherPreset = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm' | 'custom';

export interface WeatherState {
  preset: WeatherPreset;
  /** m/s at 100 m AGL. */
  windSpeed: number;
  /** Direction the wind blows FROM, degrees true. */
  windDirection: number;
  /** 0..1 */
  turbulence: number;
  /** 0..1 */
  cloudCover: number;
  /** 0..1 */
  rain: number;
  /** 0..1 (1 ≈ 300 m visibility) */
  fog: number;
  /** 0..1 lightning activity */
  lightning: number;
  /** Local solar time, hours 0..24. */
  timeOfDay: number;
  /** Multiplier on how fast the clock runs (0 = frozen). */
  timeScale: number;
  /** Multiplier on ISA sea-level density. */
  airDensityScale: number;
  /** m/s². */
  gravity: number;
}

export interface ReplayFrame {
  t: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** m/s */
  speed: number;
  /** m MSL */
  altitude: number;
  verticalSpeed: number;
  throttle: number;
  gear: number;
  flaps: number;
  elevator: number;
  aileron: number;
  rudder: number;
  rpm: number;
  onGround: boolean;
}

export interface LandingReport {
  time: number;
  airport: string | null;
  runway: string | null;
  surface: SurfaceKind;
  touchdownSpeed: number; // m/s
  referenceSpeed: number; // m/s
  verticalSpeed: number; // m/s (positive = descending)
  alignmentError: number | null; // degrees off runway heading
  centerlineOffset: number | null; // metres
  bank: number; // deg at touchdown
  pitch: number; // deg at touchdown
  gearDown: boolean;
  bounces: number;
  damage: number;
  /** Component scores 0..100. */
  scores: { speed: number; descent: number; alignment: number; stability: number; gear: number };
  total: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
}

export interface FlightRecord {
  id: string;
  createdAt: number;
  aircraftId: AircraftId;
  origin: string;
  duration: number;
  distance: number;
  maxAltitude: number;
  maxSpeed: number;
  landing: LandingReport | null;
  crashed: boolean;
  saved: boolean;
  controlMode: 'hand' | 'keyboard' | 'mixed';
  frames: ReplayFrame[];
}

export type GraphicsPreset = 'low' | 'medium' | 'high';
export type CameraMode = 'cockpit' | 'chase' | 'cinematic' | 'instruments';
