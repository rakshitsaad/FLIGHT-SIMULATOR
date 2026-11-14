import type { Vec3 } from '../../types';

export type Delegate = 'GPU' | 'CPU';

export interface InitMessage {
  type: 'init';
  wasmPath: string;
  modelPath: string;
  delegate: Delegate;
}
export interface FrameMessage {
  type: 'frame';
  bitmap: ImageBitmap;
  ts: number;
}
export type ToWorker = InitMessage | FrameMessage;

export interface RawHand {
  landmarks: Vec3[];
  world: Vec3[];
  label: string;
  score: number;
}

export type FromWorker =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'result'; ts: number; hand: RawHand | null; inferMs: number }
  | { type: 'error'; message: string };

export const HAND_OPTIONS = {
  runningMode: 'VIDEO' as const,
  /** One hand, always. */
  numHands: 1,
  minHandDetectionConfidence: 0.55,
  minHandPresenceConfidence: 0.55,
  minTrackingConfidence: 0.5,
};
