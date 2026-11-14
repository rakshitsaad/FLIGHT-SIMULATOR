/**
 * Live visualisation of the single-hand controller: the mirrored webcam
 * picture with the 21-landmark skeleton, the virtual joystick and the
 * throttle meter. Drawn straight to canvases every animation frame — no
 * React state is involved, so they stay smooth while flying.
 */
import { useEffect, useRef } from 'react';
import { useSettings } from '../stores/settingsStore';
import { HAND_CONNECTIONS } from '../vision/landmarks/handModel';
import { PAUSE_CLOSURE, THROTTLE_FULL_CLOSURE, THROTTLE_IDLE_CLOSURE } from '../vision/SingleHandFlightController';
import { vision } from '../vision/VisionService';

function useRaf(draw: (dt: number) => void): void {
  const fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    let id = 0;
    let last = performance.now();
    const loop = (now: number) => {
      fn.current(Math.min(0.1, (now - last) / 1000));
      last = now;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

function fit(canvas: HTMLCanvasElement): { w: number; h: number; g: CanvasRenderingContext2D } | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, g };
}

const STATUS_COLOR: Record<string, string> = { tracking: '#46d37e', lost: '#ff6257', searching: '#ffc542', 'wrong-hand': '#ffc542', off: '#6b7a88', starting: '#ffc542', error: '#ff6257' };

/** Mirrored webcam preview with the hand skeleton and the calibrated neutral point. */
export function HandPreview({ showNeutral = true, className = '' }: { showNeutral?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRaf(() => {
    const c = ref.current;
    if (!c) return;
    const f = fit(c);
    if (!f) return;
    const { w, h, g } = f;
    const video = vision.camera.video;
    const snap = vision.controller.snapshot;
    g.fillStyle = '#05080c';
    g.fillRect(0, 0, w, h);
    const live = vision.camera.state === 'live' && video.readyState >= 2 && video.videoWidth > 0;
    // letterbox the camera image
    const aspect = live ? video.videoWidth / video.videoHeight : 4 / 3;
    let dw = w;
    let dh = w / aspect;
    if (dh > h) {
      dh = h;
      dw = h * aspect;
    }
    const ox = (w - dw) / 2;
    const oy = (h - dh) / 2;
    if (live) {
      g.save();
      g.translate(ox + dw, oy);
      g.scale(-1, 1); // mirror: moving your hand right moves it right on screen
      g.drawImage(video, 0, 0, dw, dh);
      g.restore();
      g.fillStyle = 'rgba(4,10,16,0.25)';
      g.fillRect(ox, oy, dw, dh);
    } else {
      g.fillStyle = '#6b7a88';
      g.font = '12px system-ui';
      g.textAlign = 'center';
      g.fillText('camera off', w / 2, h / 2);
    }
    const cal = vision.controller.calibration;
    if (showNeutral && live) {
      // neutral point and calibrated travel
      const nx = ox + (cal.neutral.x / aspect) * dw;
      const ny = oy + cal.neutral.y * dh;
      g.strokeStyle = 'rgba(87,199,255,0.55)';
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeRect(nx - (cal.rollLeft / aspect) * dw, ny - cal.pitchUp * dh, ((cal.rollLeft + cal.rollRight) / aspect) * dw, (cal.pitchUp + cal.pitchDown) * dh);
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(nx - 7, ny);
      g.lineTo(nx + 7, ny);
      g.moveTo(nx, ny - 7);
      g.lineTo(nx, ny + 7);
      g.stroke();
    }
    const hand = snap.landmarks;
    if (hand && live) {
      const px = (i: number) => ox + hand.image[i].x * dw;
      const py = (i: number) => oy + hand.image[i].y * dh;
      g.lineCap = 'round';
      g.strokeStyle = snap.gesture.active ? '#ffb21a' : '#57c7ff';
      g.lineWidth = Math.max(1.5, dw / 170);
      g.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        g.moveTo(px(a), py(a));
        g.lineTo(px(b), py(b));
      }
      g.stroke();
      g.fillStyle = '#ffffff';
      const r = Math.max(1.6, dw / 150);
      for (let i = 0; i < 21; i++) {
        g.beginPath();
        g.arc(px(i), py(i), i % 4 === 0 && i > 0 ? r * 1.35 : r, 0, Math.PI * 2);
        g.fill();
      }
      // palm centre
      const cx = ox + (snap.features.palmCenter.x / aspect) * dw;
      const cy = oy + snap.features.palmCenter.y * dh;
      g.strokeStyle = '#46d37e';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, Math.max(5, dw / 45), 0, Math.PI * 2);
      g.stroke();
    }
    // status pill
    const st = snap.status;
    g.fillStyle = 'rgba(5,8,12,0.72)';
    g.fillRect(6, 6, 98, 18);
    g.fillStyle = STATUS_COLOR[st] ?? '#6b7a88';
    g.beginPath();
    g.arc(15, 15, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e9f1f8';
    g.font = '600 10px system-ui';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(st === 'wrong-hand' ? 'OTHER HAND' : st.toUpperCase(), 24, 15.5);
  });
  return <canvas ref={ref} className={`hand-preview ${className}`} />;
}

/**
 * Virtual joystick: circular pad (roll ↔, pitch ↕) with dead zone, raw and
 * conditioned stick position, a rudder strip and the throttle meter.
 */
export function VirtualJoystick({ size = 150, className = '' }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRaf(() => {
    const c = ref.current;
    if (!c) return;
    const f = fit(c);
    if (!f) return;
    const { w, h, g } = f;
    const s = useSettings.getState();
    const snap = vision.controller.snapshot;
    const tracking = snap.status === 'tracking';
    g.clearRect(0, 0, w, h);
    const thrW = 26;
    const pad = Math.min(w - thrW - 14, h - 26);
    const R = pad / 2 - 4;
    const cx = 6 + pad / 2;
    const cy = pad / 2 + 2;

    // pad
    g.fillStyle = 'rgba(8,14,22,0.78)';
    g.beginPath();
    g.arc(cx, cy, R + 3, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = tracking ? 'rgba(87,199,255,0.8)' : 'rgba(140,160,180,0.45)';
    g.lineWidth = 1.5;
    g.stroke();
    // axes
    g.strokeStyle = 'rgba(140,180,220,0.3)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();
    for (const k of [0.5, 1]) {
      g.beginPath();
      g.arc(cx, cy, R * k, 0, Math.PI * 2);
      g.stroke();
    }
    // dead zone
    g.fillStyle = 'rgba(255,178,26,0.16)';
    g.strokeStyle = 'rgba(255,178,26,0.7)';
    g.beginPath();
    g.arc(cx, cy, Math.max(2, R * s.deadZone), 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // sensitivity indicator: arc length around the rim
    g.strokeStyle = '#57c7ff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.sensitivity / 2.5));
    g.stroke();
    // labels
    g.fillStyle = 'rgba(200,220,240,0.6)';
    g.font = '600 9px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('NOSE UP', cx, cy - R + 9);
    g.fillText('NOSE DN', cx, cy + R - 9);
    g.save();
    g.translate(cx - R + 9, cy);
    g.rotate(-Math.PI / 2);
    g.fillText('LEFT', 0, 0);
    g.restore();
    g.save();
    g.translate(cx + R - 9, cy);
    g.rotate(Math.PI / 2);
    g.fillText('RIGHT', 0, 0);
    g.restore();

    // raw hand position (hollow) and conditioned output (solid)
    const clampDisc = (x: number, y: number): [number, number] => {
      const m = Math.hypot(x, y);
      return m > 1.12 ? [x / m * 1.12, y / m * 1.12] : [x, y];
    };
    const [rx, ry] = clampDisc(snap.rawRoll, snap.rawPitch);
    g.strokeStyle = tracking ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx + rx * R, cy - ry * R, 6, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(87,199,255,0.5)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + snap.roll * R, cy - snap.pitch * R);
    g.stroke();
    g.fillStyle = tracking ? '#57c7ff' : '#6b7a88';
    g.beginPath();
    g.arc(cx + snap.roll * R, cy - snap.pitch * R, 5, 0, Math.PI * 2);
    g.fill();

    // rudder strip under the pad
    const yy = cy + R + 14;
    g.fillStyle = 'rgba(8,14,22,0.78)';
    g.fillRect(cx - R, yy - 5, R * 2, 10);
    g.fillStyle = 'rgba(255,178,26,0.2)';
    g.fillRect(cx - R * s.yawDeadZone, yy - 5, R * 2 * s.yawDeadZone, 10);
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx + Math.max(-1.1, Math.min(1.1, snap.rawYaw)) * R, yy, 4, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = tracking ? '#57c7ff' : '#6b7a88';
    g.fillRect(cx + snap.yaw * R - 2, yy - 6, 4, 12);
    g.fillStyle = 'rgba(200,220,240,0.6)';
    g.font = '600 8px system-ui';
    g.fillText('RUDDER (wrist)', cx, yy + 13);

    // throttle meter
    const tx = w - thrW - 2;
    const th = pad - 8;
    const ty = 6;
    g.fillStyle = 'rgba(8,14,22,0.78)';
    g.fillRect(tx, ty, thrW, th);
    const closure = Math.min(1.15, snap.closure) / 1.15;
    const lv = (v: number) => ty + th - (v / 1.15) * th;
    // pause zone
    g.fillStyle = 'rgba(255,98,87,0.28)';
    g.fillRect(tx, ty, thrW, lv(PAUSE_CLOSURE) - ty);
    // usable throttle band
    g.fillStyle = 'rgba(87,199,255,0.12)';
    g.fillRect(tx, lv(THROTTLE_FULL_CLOSURE), thrW, lv(THROTTLE_IDLE_CLOSURE) - lv(THROTTLE_FULL_CLOSURE));
    // output throttle
    g.fillStyle = snap.gesture.throttleFrozen ? '#ffb21a' : '#46d37e';
    const oh = snap.throttle * (lv(THROTTLE_IDLE_CLOSURE) - lv(THROTTLE_FULL_CLOSURE));
    g.fillRect(tx + 3, lv(THROTTLE_IDLE_CLOSURE) - oh, thrW - 6, oh);
    // live finger closure marker
    g.fillStyle = '#ffffff';
    g.fillRect(tx - 2, ty + th - closure * th - 1, thrW + 4, 2);
    g.strokeStyle = 'rgba(140,180,220,0.4)';
    g.lineWidth = 1;
    g.strokeRect(tx + 0.5, ty + 0.5, thrW - 1, th - 1);
    g.fillStyle = 'rgba(200,220,240,0.7)';
    g.font = '600 8px system-ui';
    g.textAlign = 'center';
    g.fillText('FIST', tx + thrW / 2, ty - 0 + 8);
    g.fillText('OPEN', tx + thrW / 2, ty + th - 6);
    g.font = '700 10px system-ui';
    g.fillStyle = '#e9f1f8';
    g.fillText(`${Math.round(snap.throttle * 100)}%`, tx + thrW / 2, ty + th + 12);
    // fist-hold countdown
    if (snap.gesture.fistHold > 0.02) {
      g.strokeStyle = '#ff6257';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, cy, R * 0.6, -Math.PI / 2, -Math.PI / 2 + snap.gesture.fistHold * Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ff6257';
      g.font = '700 10px system-ui';
      g.fillText('HOLD = PAUSE', cx, cy - R * 0.25);
    }
  });
  return <canvas ref={ref} className={`virtual-joystick ${className}`} style={{ width: size + 44, height: size + 26 }} />;
}
