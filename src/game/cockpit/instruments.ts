/**
 * Flight instruments drawn on a 2D canvas. The same drawing code feeds the
 * 3D cockpit panel texture and the instrument-focused view; every needle is
 * positioned from the live AircraftState.
 */
import type { AircraftState } from '../../types';
import type { AircraftSpec } from '../aircraft/specs';
import { stallSpeeds } from '../aircraft/specs';

export const PANEL_W = 1024;
export const PANEL_H = 512;
const R = 104;
const KT = 1.94384;
const FT = 3.28084;
const FPM = 196.85;
const TAU = Math.PI * 2;

type Ctx = CanvasRenderingContext2D;

function face(g: Ctx, x: number, y: number, label: string, sub = ''): void {
  g.save();
  g.translate(x, y);
  const grad = g.createRadialGradient(0, -20, 10, 0, 0, R + 10);
  grad.addColorStop(0, '#1b1f25');
  grad.addColorStop(1, '#0a0c0f');
  g.fillStyle = '#2b3038';
  g.beginPath();
  g.arc(0, 0, R + 9, 0, TAU);
  g.fill();
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  g.fillStyle = '#9aa4ae';
  g.font = '600 13px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(label, 0, 38);
  if (sub) {
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = '#6f7983';
    g.fillText(sub, 0, 54);
  }
  g.restore();
}

function ticks(g: Ctx, x: number, y: number, a0: number, a1: number, n: number, major: number, labels?: (i: number) => string | null): void {
  g.save();
  g.translate(x, y);
  g.strokeStyle = '#e8edf2';
  g.fillStyle = '#e8edf2';
  g.font = '600 15px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const big = i % major === 0;
    g.lineWidth = big ? 2.6 : 1.3;
    g.beginPath();
    g.moveTo(Math.cos(a) * (R - (big ? 16 : 9)), Math.sin(a) * (R - (big ? 16 : 9)));
    g.lineTo(Math.cos(a) * (R - 2), Math.sin(a) * (R - 2));
    g.stroke();
    const t = big && labels ? labels(i) : null;
    if (t !== null && t !== undefined) g.fillText(t, Math.cos(a) * (R - 31), Math.sin(a) * (R - 31));
  }
  g.restore();
}

function arc(g: Ctx, x: number, y: number, a0: number, a1: number, color: string, w = 6, r = R - 5): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  g.arc(x, y, r, a0, a1);
  g.stroke();
}

function needle(g: Ctx, x: number, y: number, a: number, len: number, color = '#ffffff', w = 4): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-14, -w / 2);
  g.lineTo(len - 8, -w / 2);
  g.lineTo(len, 0);
  g.lineTo(len - 8, w / 2);
  g.lineTo(-14, w / 2);
  g.closePath();
  g.fill();
  g.fillStyle = '#30363d';
  g.beginPath();
  g.arc(0, 0, 8, 0, TAU);
  g.fill();
  g.restore();
}

function readout(g: Ctx, x: number, y: number, text: string, color = '#eaf2f8'): void {
  g.fillStyle = '#05070a';
  g.fillRect(x - 38, y - 12, 76, 24);
  g.strokeStyle = '#3a424c';
  g.lineWidth = 1;
  g.strokeRect(x - 38, y - 12, 76, 24);
  g.fillStyle = color;
  g.font = '700 16px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + 1);
}

const COLS = [132, 384, 636, 888];
const ROWS = [130, 382];
const A0 = Math.PI * 0.75; // dial sweep start (7:30)
const A1 = Math.PI * 2.25; // dial sweep end (4:30)

export class InstrumentPanel {
  readonly canvas: HTMLCanvasElement;
  private g: Ctx;
  private bg: HTMLCanvasElement;
  private spec: AircraftSpec;
  private maxKt: number;
  private altBg = 0;

  constructor(spec: AircraftSpec) {
    this.spec = spec;
    this.canvas = document.createElement('canvas');
    this.canvas.width = PANEL_W;
    this.canvas.height = PANEL_H;
    this.g = this.canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    this.bg.width = PANEL_W;
    this.bg.height = PANEL_H;
    const top = spec.vne * KT * 1.08;
    this.maxKt = top > 400 ? 800 : top > 200 ? 320 : top > 130 ? 200 : 160;
    this.drawStatic();
  }

  private drawStatic(): void {
    const g = this.bg.getContext('2d')!;
    const spec = this.spec;
    const grad = g.createLinearGradient(0, 0, 0, PANEL_H);
    grad.addColorStop(0, '#22262d');
    grad.addColorStop(1, '#15181d');
    g.fillStyle = grad;
    g.fillRect(0, 0, PANEL_W, PANEL_H);
    g.strokeStyle = '#0c0e11';
    g.lineWidth = 3;
    g.strokeRect(6, 6, PANEL_W - 12, PANEL_H - 12);
    for (const [sx, sy] of [[18, 18], [PANEL_W - 18, 18], [18, PANEL_H - 18], [PANEL_W - 18, PANEL_H - 18]]) {
      g.fillStyle = '#3a4048';
      g.beginPath();
      g.arc(sx, sy, 5, 0, TAU);
      g.fill();
    }
    // airspeed
    const [c0, c1, c2, c3] = COLS;
    const [r0, r1] = ROWS;
    face(g, c0, r0, 'AIRSPEED', 'KNOTS');
    const vs = stallSpeeds(spec);
    const kA = (kt: number) => A0 + ((A1 - A0) * Math.min(kt, this.maxKt)) / this.maxKt;
    arc(g, c0, r0, kA(vs.landing * KT), kA(spec.vne * 0.62 * KT), '#e9e9e9', 4, R - 12);
    arc(g, c0, r0, kA(vs.clean * KT), kA(spec.vne * 0.8 * KT), '#2fbf5b');
    arc(g, c0, r0, kA(spec.vne * 0.8 * KT), kA(spec.vne * KT), '#e8c02a');
    arc(g, c0, r0, kA(spec.vne * KT) - 0.02, kA(spec.vne * KT) + 0.03, '#e03a2f', 12);
    const step = this.maxKt / 16;
    ticks(g, c0, r0, A0, A1, 16, 2, (i) => String(Math.round(i * step)));
    // attitude bezel
    face(g, c1, r0, '', '');
    // altimeter
    face(g, c2, r0, 'ALT', 'FEET × 100');
    ticks(g, c2, r0, -Math.PI / 2, Math.PI * 1.5, 50, 5, (i) => (i < 50 ? String(i / 5) : null));
    // RPM
    face(g, c3, r0, spec.rpmLabel, spec.engineType === 'jet' ? '' : '× 100');
    const rmax = spec.engineType === 'jet' ? 110 : Math.ceil((spec.rpmMax * 1.12) / 500) * 500;
    const n = spec.engineType === 'jet' ? 11 : Math.round(rmax / 500);
    const major = spec.engineType === 'jet' ? 2 : n > 8 ? 2 : 1;
    arc(g, c3, r0, A0 + ((A1 - A0) * spec.rpmIdle) / rmax, A0 + ((A1 - A0) * spec.rpmMax * 0.92) / rmax, '#2fbf5b');
    arc(g, c3, r0, A0 + ((A1 - A0) * spec.rpmMax) / rmax - 0.02, A0 + ((A1 - A0) * spec.rpmMax) / rmax + 0.03, '#e03a2f', 12);
    ticks(g, c3, r0, A0, A1, n, major, (i) => String(spec.engineType === 'jet' ? i * 10 : (i * 500) / 100));
    // turn coordinator
    face(g, c0, r1, 'TURN COORDINATOR', '2 MIN');
    g.save();
    g.translate(c0, r1);
    g.strokeStyle = '#e8edf2';
    g.lineWidth = 3;
    for (const a of [0, Math.PI, 0.35, Math.PI - 0.35]) {
      g.beginPath();
      g.moveTo(Math.cos(a) * (R - 16), -Math.sin(a) * (R - 16) * (a > 0.1 && a < 3 ? -1 : 1));
      g.lineTo(Math.cos(a) * (R - 3), -Math.sin(a) * (R - 3) * (a > 0.1 && a < 3 ? -1 : 1));
      g.stroke();
    }
    g.fillStyle = '#e8edf2';
    g.font = '700 14px system-ui';
    g.textAlign = 'center';
    g.fillText('L', -R + 30, 46);
    g.fillText('R', R - 30, 46);
    g.restore();
    // heading
    face(g, c1, r1, '', '');
    // VSI
    face(g, c2, r1, 'VERTICAL SPEED', 'FT/MIN × 1000');
    ticks(g, c2, r1, Math.PI - 2.6, Math.PI + 2.6, 24, 4, (i) => String(Math.abs((i - 12) / 4)));
    g.fillStyle = '#9aa4ae';
    g.font = '11px system-ui';
    g.textAlign = 'center';
    g.fillText('UP', c2 - 44, r1 - 22);
    g.fillText('DN', c2 - 44, r1 + 30);
    // systems block
    g.fillStyle = '#0d1014';
    g.fillRect(c3 - R - 6, r1 - R - 6, 2 * R + 12, 2 * R + 12);
    g.strokeStyle = '#2b3038';
    g.lineWidth = 3;
    g.strokeRect(c3 - R - 6, r1 - R - 6, 2 * R + 12, 2 * R + 12);
    g.fillStyle = '#9aa4ae';
    g.font = '600 12px system-ui';
    g.textAlign = 'left';
    g.fillText('FUEL', c3 - R + 8, r1 - R + 18);
    g.fillText('FLAPS', c3 - R + 8, r1 - R + 76);
    g.fillText('GEAR', c3 - R + 8, r1 - R + 134);
    g.fillText('THROTTLE', c3 - R + 8, r1 - R + 180);
    this.altBg = rmax;
  }

  draw(s: AircraftState): void {
    const g = this.g;
    const spec = this.spec;
    g.drawImage(this.bg, 0, 0);
    const [c0, c1, c2, c3] = COLS;
    const [r0, r1] = ROWS;

    // ---- airspeed
    const kt = s.indicatedAirspeed * KT;
    needle(g, c0, r0, A0 + ((A1 - A0) * Math.min(kt, this.maxKt)) / this.maxKt, R - 18);
    readout(g, c0, r0 + 74, kt.toFixed(0), s.stallWarning ? '#ff6b5e' : s.overspeed ? '#ffcf3f' : '#eaf2f8');

    // ---- attitude indicator
    g.save();
    g.beginPath();
    g.arc(c1, r0, R - 2, 0, TAU);
    g.clip();
    g.translate(c1, r0);
    g.rotate(-s.bank);
    const pxPerRad = 190;
    const off = s.pitch * pxPerRad;
    g.fillStyle = '#2f7fd6';
    g.fillRect(-300, -400 + off, 600, 400);
    g.fillStyle = '#7a4f2a';
    g.fillRect(-300, off, 600, 400);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-300, off);
    g.lineTo(300, off);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '600 12px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = -60; d <= 60; d += 5) {
      if (d === 0) continue;
      const y = off - (d * Math.PI) / 180 * pxPerRad;
      if (y < -R || y > R) continue;
      const w = d % 10 === 0 ? 34 : 16;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(-w, y);
      g.lineTo(w, y);
      g.stroke();
      if (d % 10 === 0) {
        g.fillText(String(Math.abs(d)), -w - 14, y);
        g.fillText(String(Math.abs(d)), w + 14, y);
      }
    }
    // bank scale rotates with the horizon
    g.strokeStyle = '#ffffff';
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (-90 + b) * (Math.PI / 180);
      g.lineWidth = b % 30 === 0 ? 3 : 1.6;
      g.beginPath();
      g.moveTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4));
      g.lineTo(Math.cos(a) * (R - (b % 30 === 0 ? 20 : 13)), Math.sin(a) * (R - (b % 30 === 0 ? 20 : 13)));
      g.stroke();
    }
    g.restore();
    // fixed aircraft symbol + bank pointer
    g.strokeStyle = '#ffb21a';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(c1 - 62, r0);
    g.lineTo(c1 - 22, r0);
    g.lineTo(c1 - 22, r0 + 9);
    g.moveTo(c1 + 62, r0);
    g.lineTo(c1 + 22, r0);
    g.lineTo(c1 + 22, r0 + 9);
    g.stroke();
    g.fillStyle = '#ffb21a';
    g.beginPath();
    g.arc(c1, r0, 4, 0, TAU);
    g.fill();
    g.beginPath();
    g.moveTo(c1, r0 - R + 22);
    g.lineTo(c1 - 8, r0 - R + 36);
    g.lineTo(c1 + 8, r0 - R + 36);
    g.closePath();
    g.fill();

    // ---- altimeter (feet)
    const ft = s.altitude * FT;
    needle(g, c2, r0, -Math.PI / 2 + ((ft % 10000) / 10000) * TAU, R - 52, '#ffffff', 7);
    needle(g, c2, r0, -Math.PI / 2 + ((ft % 1000) / 1000) * TAU, R - 16, '#ffffff', 3.5);
    readout(g, c2, r0 + 74, Math.round(ft / 10) * 10 + '');

    // ---- RPM / N1
    const rmax = this.altBg;
    needle(g, c3, r0, A0 + ((A1 - A0) * Math.min(s.rpm, rmax)) / rmax, R - 18);
    readout(g, c3, r0 + 74, spec.engineType === 'jet' ? s.rpm.toFixed(0) + '%' : Math.round(s.rpm / 10) * 10 + '', s.engineRunning ? '#eaf2f8' : '#ff6b5e');

    // ---- turn coordinator: miniature aircraft banks with turn rate, ball shows slip
    const turnRate = -s.angularVelocity.y * Math.cos(s.bank) + s.angularVelocity.x * Math.sin(s.bank);
    const tilt = Math.max(-0.7, Math.min(0.7, (turnRate / 0.0524) * 0.35));
    g.save();
    g.translate(c0, r1 - 8);
    g.rotate(tilt);
    g.fillStyle = '#ffffff';
    g.fillRect(-64, -3, 128, 6);
    g.fillRect(-4, -22, 8, 22);
    g.beginPath();
    g.arc(0, 0, 9, 0, TAU);
    g.fill();
    g.restore();
    g.fillStyle = '#05070a';
    g.fillRect(c0 - 58, r1 + 58, 116, 20);
    g.strokeStyle = '#59636e';
    g.lineWidth = 1.5;
    g.strokeRect(c0 - 14, r1 + 58, 28, 20);
    g.fillStyle = '#e8edf2';
    g.beginPath();
    g.arc(c0 + Math.max(-46, Math.min(46, -s.beta * 320)), r1 + 68, 8.5, 0, TAU);
    g.fill();

    // ---- heading indicator: rotating compass card
    g.save();
    g.beginPath();
    g.arc(c1, r1, R - 2, 0, TAU);
    g.clip();
    g.translate(c1, r1);
    g.rotate((-s.heading * Math.PI) / 180);
    g.strokeStyle = '#e8edf2';
    g.fillStyle = '#e8edf2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180;
      g.save();
      g.rotate(a);
      g.lineWidth = d % 30 === 0 ? 2.8 : 1.3;
      g.beginPath();
      g.moveTo(0, -R + 3);
      g.lineTo(0, -R + (d % 10 === 0 ? 18 : 10));
      g.stroke();
      if (d % 30 === 0) {
        g.font = d % 90 === 0 ? '700 20px system-ui' : '600 15px system-ui';
        g.fillText(d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10), 0, -R + 32);
      }
      g.restore();
    }
    g.restore();
    g.fillStyle = '#ffb21a';
    g.beginPath();
    g.moveTo(c1, r1 - R + 2);
    g.lineTo(c1 - 9, r1 - R - 12);
    g.lineTo(c1 + 9, r1 - R - 12);
    g.closePath();
    g.fill();
    g.strokeStyle = '#ffb21a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(c1, r1 - 36);
    g.lineTo(c1, r1 + 30);
    g.moveTo(c1 - 30, r1 - 4);
    g.lineTo(c1 + 30, r1 - 4);
    g.moveTo(c1 - 12, r1 + 22);
    g.lineTo(c1 + 12, r1 + 22);
    g.stroke();
    readout(g, c1, r1 + 74, String(Math.round(s.heading) % 360).padStart(3, '0') + '°');

    // ---- vertical speed
    const fpm = Math.max(-3000, Math.min(3000, s.verticalSpeed * FPM));
    needle(g, c2, r1, Math.PI + (fpm / 3000) * 2.6, R - 18);
    readout(g, c2 + 34, r1 + 74, (fpm >= 0 ? '+' : '') + Math.round(fpm / 10) * 10);

    // ---- systems
    const x0 = c3 - R + 8;
    const bw = 2 * R - 16;
    const y0 = r1 - R;
    const bar = (y: number, f: number, color: string) => {
      g.fillStyle = '#1b2027';
      g.fillRect(x0, y, bw, 22);
      g.fillStyle = color;
      g.fillRect(x0, y, bw * Math.max(0, Math.min(1, f)), 22);
      g.strokeStyle = '#3a424c';
      g.lineWidth = 1;
      g.strokeRect(x0, y, bw, 22);
    };
    bar(y0 + 26, s.fuelFraction, s.fuelFraction < 0.15 ? '#e03a2f' : s.fuelFraction < 0.3 ? '#e8c02a' : '#36c26a');
    g.fillStyle = '#eaf2f8';
    g.font = '700 13px ui-monospace, monospace';
    g.textAlign = 'right';
    g.fillText(`${Math.round(s.fuelFraction * 100)}%`, x0 + bw - 6, y0 + 42);
    // flaps: one lamp per notch
    const notches = spec.flapNotches.length;
    for (let i = 0; i < notches; i++) {
      const w = (bw - (notches - 1) * 6) / notches;
      g.fillStyle = i <= s.flapsNotch && i > 0 ? '#57c7ff' : i === 0 && s.flapsNotch === 0 ? '#3a8a55' : '#1b2027';
      g.fillRect(x0 + i * (w + 6), y0 + 84, w, 22);
      g.fillStyle = '#0a0c0f';
      g.textAlign = 'center';
      g.font = '700 12px system-ui';
      g.fillText(i === 0 ? 'UP' : String(Math.round(spec.flapNotches[i] * 30)) + '°', x0 + i * (w + 6) + w / 2, y0 + 100);
    }
    // gear: three greens / red in transit
    const transit = s.gear > 0.02 && s.gear < 0.98;
    for (let i = 0; i < 3; i++) {
      g.fillStyle = transit ? '#e03a2f' : s.gear >= 0.98 ? '#36c26a' : '#1b2027';
      g.beginPath();
      g.arc(x0 + 36 + i * 46, y0 + 156 - (i === 1 ? 8 : 0), 11, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#9aa4ae';
    g.textAlign = 'right';
    g.font = '700 12px system-ui';
    g.fillText(transit ? 'IN TRANSIT' : s.gear >= 0.98 ? 'DOWN' : 'UP', x0 + bw, y0 + 160);
    bar(y0 + 186, s.throttle, '#ffb21a');
    g.fillStyle = '#ffffff';
    g.fillRect(x0 + bw * s.enginePower - 1.5, y0 + 183, 3, 28);
    // annunciators
    const lamp = (i: number, text: string, on: boolean, color: string) => {
      const w = (bw - 12) / 3;
      g.fillStyle = on ? color : '#1b2027';
      g.fillRect(x0 + i * (w + 6), y0 + 2 * R - 12, w, 18);
      g.fillStyle = on ? '#0a0c0f' : '#4a535d';
      g.font = '700 11px system-ui';
      g.textAlign = 'center';
      g.fillText(text, x0 + i * (w + 6) + w / 2, y0 + 2 * R + 1);
    };
    lamp(0, 'STALL', s.stallWarning, '#e03a2f');
    lamp(1, 'A/P', s.autopilot, '#57c7ff');
    lamp(2, 'BRAKE', s.brake > 0.3, '#e8c02a');
  }
}
