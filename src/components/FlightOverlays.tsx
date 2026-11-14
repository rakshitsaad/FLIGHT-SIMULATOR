import { useEffect, useState } from 'react';
import { exitToMenu, openReplay, respawn } from '../app/actions';
import { sim } from '../game/engine/Simulation';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import type { CameraMode } from '../types';
import { Button, fmtSpeed } from './ui';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, []);
  const now = performance.now();
  return (
    <div className="toasts">
      {toasts
        .filter((t) => t.until > now)
        .map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
    </div>
  );
}

export function LoadingOverlay() {
  const loading = useApp((s) => s.loading);
  if (!loading) return null;
  return (
    <div className="loading">
      <div className="spinner" />
      <span>Streaming AERONA terrain…</span>
    </div>
  );
}

const CAMS: { id: CameraMode; label: string; key: string }[] = [
  { id: 'cockpit', label: 'Cockpit', key: '1' },
  { id: 'chase', label: 'Chase', key: '2' },
  { id: 'cinematic', label: 'Cinematic', key: '3' },
  { id: 'instruments', label: 'Instruments', key: '4' },
];

export function FlightToolbar() {
  const app = useApp();
  return (
    <div className="toolbar">
      <button type="button" data-tool="pause" onClick={() => app.set({ paused: true })} title="Pause (Esc / P)">
        ❚❚
      </button>
      {CAMS.map((c) => (
        <button key={c.id} type="button" data-cam={c.id} className={app.camera === c.id ? 'active' : ''} onClick={() => app.set({ camera: c.id })} title={`${c.label} camera (${c.key})`}>
          {c.label}
        </button>
      ))}
      <button type="button" data-tool="weather" className={app.panel === 'weather' ? 'active' : ''} onClick={() => app.set({ panel: app.panel === 'weather' ? null : 'weather' })} title="Weather panel (Tab)">
        Weather
      </button>
      <button type="button" data-tool="experiment" className={app.panel === 'experiment' ? 'active' : ''} onClick={() => app.set({ panel: app.panel === 'experiment' ? null : 'experiment' })} title="Experiment sandbox">
        Experiment
      </button>
      <button type="button" data-tool="help" className={app.help ? 'active' : ''} onClick={() => app.set({ help: !app.help })} title="Controls (K)">
        ?
      </button>
    </div>
  );
}

export function HelpOverlay() {
  const help = useApp((s) => s.help);
  const set = useApp((s) => s.set);
  if (!help) return null;
  return (
    <div className="help" onClick={() => set({ help: false })}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <h3>One-hand control</h3>
        <table>
          <tbody>
            <tr><td>Move hand left / right</td><td>Bank left / right</td></tr>
            <tr><td>Move hand up / down</td><td>Nose up / down</td></tr>
            <tr><td>Rotate wrist like a dial</td><td>Rudder (yaw); steers on the ground</td></tr>
            <tr><td>Open hand → closed hand</td><td>Throttle idle → full (starts the engine)</td></tr>
            <tr><td>Open hand on the ground</td><td>Wheel brakes</td></tr>
            <tr><td>🤏 Pinch thumb + index</td><td>Landing gear</td></tr>
            <tr><td>👍 Thumbs up</td><td>Autopilot (holds heading & altitude)</td></tr>
            <tr><td>✌️ Victory sign</td><td>Next flap setting</td></tr>
            <tr><td>✊ Tight fist, thumb wrapped, 2 s</td><td>Emergency pause / resume</td></tr>
          </tbody>
        </table>
        <h3>Keyboard</h3>
        <table>
          <tbody>
            <tr><td>W / S or ↑ / ↓</td><td>Nose down / up</td></tr>
            <tr><td>A / D or ← / →</td><td>Bank left / right</td></tr>
            <tr><td>Q / E</td><td>Rudder left / right</td></tr>
            <tr><td>Shift / Ctrl (or = / −)</td><td>Throttle up / down</td></tr>
            <tr><td>Space or B</td><td>Wheel brakes (hold)</td></tr>
            <tr><td>G · F · R · Z · I</td><td>Gear · flaps down · flaps up · autopilot · engine</td></tr>
            <tr><td>1 2 3 4 · C</td><td>Cockpit, chase, cinematic, instruments · cycle</td></tr>
            <tr><td>Esc or P</td><td>Pause (always works)</td></tr>
            <tr><td>H · X · Tab · M · Backspace</td><td>Hand control on/off · re-centre hand · weather · mute · restart</td></tr>
          </tbody>
        </table>
        <Button kind="primary" onClick={() => set({ help: false })}>
          CLOSE
        </Button>
      </div>
    </div>
  );
}

export function PauseMenu() {
  const app = useApp();
  const handControl = useSettings((s) => s.handControl);
  if (!app.paused) return null;
  return (
    <div className="modal">
      <div className="modal-card">
        <h2>PAUSED</h2>
        <p className="dim">{handControl ? 'Hold a tight fist for two seconds, or press Esc, to resume.' : 'Press Esc or P to resume.'}</p>
        <div className="col">
          <Button kind="primary" onClick={() => app.set({ paused: false })}>
            RESUME
          </Button>
          <Button onClick={respawn}>RESTART FROM RUNWAY</Button>
          <Button onClick={() => app.go('aircontrol', 'flight')}>AIR CONTROL — RECALIBRATE</Button>
          <Button onClick={() => app.go('map', 'flight')}>WORLD MAP</Button>
          <Button onClick={() => app.go('settings', 'flight')}>SETTINGS</Button>
          <Button onClick={() => app.set({ help: true })}>CONTROLS</Button>
          <Button kind="danger" onClick={exitToMenu}>
            END FLIGHT
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LandingCard() {
  const report = useApp((s) => s.landing);
  const set = useApp((s) => s.set);
  const units = useSettings((s) => s.units);
  if (!report) return null;
  const rows: [string, string, number][] = [
    ['Touchdown speed', `${fmtSpeed(report.touchdownSpeed, units)} (target ${fmtSpeed(report.referenceSpeed, units)})`, report.scores.speed],
    ['Descent rate', units === 'aviation' ? `${Math.round(report.verticalSpeed * 196.85)} fpm` : `${report.verticalSpeed.toFixed(1)} m/s`, report.scores.descent],
    ['Runway alignment', report.alignmentError === null ? 'off runway' : `${report.alignmentError.toFixed(1)}° off · ${report.centerlineOffset?.toFixed(1)} m from centreline`, report.scores.alignment],
    ['Stability', `bank ${Math.abs(report.bank).toFixed(1)}° · ${report.bounces} bounce${report.bounces === 1 ? '' : 's'}`, report.scores.stability],
    ['Landing gear', report.gearDown ? 'down' : 'up', report.scores.gear],
  ];
  return (
    <div className="landing-card">
      <div className="lc-head">
        <div className={`grade g-${report.grade}`}>{report.grade}</div>
        <div>
          <h3>LANDING {report.total}/100</h3>
          <p>{report.summary}</p>
        </div>
      </div>
      {rows.map(([label, value, score]) => (
        <div className="lc-row" key={label}>
          <span>{label}</span>
          <em>{value}</em>
          <b>
            <i style={{ width: `${score}%` }} className={score > 75 ? 'good' : score > 45 ? 'warn' : 'bad'} />
          </b>
        </div>
      ))}
      <div className="row">
        <Button kind="primary" onClick={() => sim.lastRecord ? void openReplay(sim.lastRecord) : (sim.finishFlight(), sim.lastRecord && void openReplay(sim.lastRecord))}>
          REPLAY FLIGHT
        </Button>
        <Button onClick={() => set({ landing: null })}>KEEP FLYING</Button>
        <Button onClick={respawn}>RESTART</Button>
      </div>
    </div>
  );
}

export function CrashCard() {
  const crash = useApp((s) => s.crash);
  if (!crash) return null;
  return (
    <div className="modal soft">
      <div className="modal-card">
        <h2 className="bad">AIRCRAFT LOST</h2>
        <p>{crash.charAt(0).toUpperCase() + crash.slice(1)}.</p>
        <div className="col">
          <Button kind="primary" onClick={respawn}>
            TRY AGAIN
          </Button>
          <Button onClick={() => sim.lastRecord && void openReplay(sim.lastRecord)} disabled={!sim.lastRecord}>
            WATCH REPLAY
          </Button>
          <Button onClick={exitToMenu}>MAIN MENU</Button>
        </div>
      </div>
    </div>
  );
}
