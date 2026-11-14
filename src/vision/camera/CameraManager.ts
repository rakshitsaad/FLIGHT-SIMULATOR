/**
 * Webcam access. The stream is only ever attached to a local <video> element:
 * frames are processed in this browser and never leave the device.
 */
export type CameraState = 'idle' | 'requesting' | 'live' | 'denied' | 'no-camera' | 'in-use' | 'insecure' | 'unsupported' | 'error';

export const CAMERA_MESSAGES: Record<CameraState, string> = {
  idle: 'Camera is off',
  requesting: 'Waiting for camera permission…',
  live: 'Camera live',
  denied: 'Camera permission was denied. Allow camera access for this site in your browser, then try again.',
  'no-camera': 'No webcam was found. Connect a camera, or fly with the keyboard.',
  'in-use': 'The camera is being used by another application. Close it and try again.',
  insecure: 'Camera access needs a secure page. Open SKYBOUND on https:// or http://localhost.',
  unsupported: 'This browser does not support camera access. Use a current desktop browser, or fly with the keyboard.',
  error: 'The camera could not be started.',
};

export class CameraManager {
  readonly video: HTMLVideoElement;
  stream: MediaStream | null = null;
  state: CameraState = 'idle';
  error = '';
  deviceLabel = '';
  /** Mean luma 0..255 of the latest probe, -1 when unknown. */
  brightness = -1;
  private probe: HTMLCanvasElement | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(deviceId?: string): Promise<CameraState> {
    if (this.state === 'live' && this.stream) return this.state;
    if (typeof window !== 'undefined' && !window.isSecureContext) return this.fail('insecure');
    if (!CameraManager.supported) return this.fail('unsupported');
    this.state = 'requesting';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => undefined);
      if (this.video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          this.video.addEventListener('loadeddata', done, { once: true });
          setTimeout(done, 3000);
        });
      }
      this.deviceLabel = stream.getVideoTracks()[0]?.label ?? '';
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        this.state = 'error';
        this.error = 'The camera was disconnected.';
        this.stream = null;
      });
      this.state = 'live';
      this.error = '';
      return this.state;
    } catch (e) {
      const name = (e as DOMException)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return this.fail('denied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return this.fail('no-camera');
      if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return this.fail('in-use');
      return this.fail('error', (e as Error)?.message);
    }
  }

  private fail(state: CameraState, detail?: string): CameraState {
    this.state = state;
    this.error = detail ? `${CAMERA_MESSAGES[state]} (${detail})` : CAMERA_MESSAGES[state];
    return state;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.state = 'idle';
    this.brightness = -1;
  }

  get aspect(): number {
    const v = this.video;
    return v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
  }

  /** Cheap exposure check on a 32×24 thumbnail. */
  measureBrightness(): number {
    const v = this.video;
    if (this.state !== 'live' || v.readyState < 2) return -1;
    if (!this.probe) {
      this.probe = document.createElement('canvas');
      this.probe.width = 32;
      this.probe.height = 24;
    }
    const ctx = this.probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return -1;
    ctx.drawImage(v, 0, 0, 32, 24);
    const d = ctx.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    this.brightness = sum / (d.length / 4);
    return this.brightness;
  }
}
