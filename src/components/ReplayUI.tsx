/** Replay viewer: transport, camera angles, flight-path inspection and speed / altitude history. */
import { useEffect, useRef, useState } from 'react';
import { goBack } from '../app/actions';
import { AIRCRAFT } from '../game/aircraft/specs';
import { sim } from '../game/engine/Simulation';
import { setFlightSaved } from '../persistence/db';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import type { CameraMode } from '../types';
import { Button, FT, KT, fmtAlt, fmtDist, fmtSpeed, fmtTime } from './ui';

const CAMS: { id: CameraMode; label: string }[] = [
  { id: 'chase', label: 'Chase' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'cockpit', label: 'Cockpit' },
];

export function ReplayUI() {
  const app = useApp();
  const units = useSettings((s) => s.units);
  const chart = useRef<HTMLCanvasElement>(null);
  const [, tick] = useState(0);
  const [saved, setSaved] = useState(sim.replay?.record.saved ?? false);
  const player = sim.replay;

  useEffect(() => {
    let id = 0;
    let n = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const p = sim.replay;
      const c = chart.current;
      if (!p || !c) return;
      if (++n % 6 === 0) tick((v) => v + 1);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const f = p.record.frames;
      const t0 = p.start;
      const dur = Math.max(1, p.duration);
      const av = useSettings.getState().units === 'aviation';
      const series = (get: (i: number) => number, color: string, label: string, unit: string, top: number, height: number) => {
        let max = 1;
        let min = Infinity;
        for (let i = 0; i < f.length; i++) {
          const v = get(i);
          if (v > max) max = v;
          if (v < min) min = v;
        }
        min = Math.min(min, max - 1);
        g.strokeStyle = 'rgba(140,180,220,0.18)';
        g.lineWidth = 1;
        g.strokeRect(0.5, top + 0.5, w - 1, height - 1);
        g.strokeStyle = color;
        g.lineWidth = 1.6;
        g.beginPath();
        const stepI = Math.max(1, Math.floor(f.length / w));
        for (let i = 0; i < f.length; i += stepI) {
          const x = ((f[i].t - t0) / dur) * w;
          const y = top + height - 4 - ((get(i) - min) / (max - min)) * (height - 10);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.fillStyle = color;
        g.font = '600 10px system-ui';
        g.textAlign = 'left';
        g.fillText(`${label}  max ${Math.round(max)} ${unit}`, 6, top + 12);
      };
      const half = h / 2;
      series((i) => (av ? f[i].speed * KT : f[i].speed * 3.6), '#57c7ff', 'SPEED', av ? 'kt' : 'km/h', 0, half - 2);
      series((i) => (av ? f[i].altitude * FT : f[i].altitude), '#ffb21a', 'ALTITUDE', av ? 'ft' : 'm', half + 2, half - 2);
      const x = (p.time / dur) * w;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  if (!player) return null;
  const rec = player.record;
  const seek = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    player.seek(((e.clientX - r.left) / r.width) * player.duration);
  };
  return (
    <div className="replay">
      <div className="replay-head">
        <div>
          <b>REPLAY</b> · {AIRCRAFT[rec.aircraftId].name} · {new Date(rec.createdAt).toLocaleString()} · {rec.origin}
        </div>
        <div className="dim">
          {fmtTime(rec.duration)} · {fmtDist(rec.distance, units)} · max {fmtAlt(rec.maxAltitude, units)} · max {fmtSpeed(rec.maxSpeed, units)}
          {rec.landing ? ` · landing ${rec.landing.grade} (${rec.landing.total})` : rec.crashed ? ' · crashed' : ''}
        </div>
      </div>
      <div className="replay-bar">
        <canvas ref={chart} className="replay-chart" onClick={seek} onMouseMove={(e) => e.buttons === 1 && seek(e)} title="Speed and altitude history — click to jump" />
        <div className="replay-controls">
          <Button
            kind="primary"
            onClick={() => {
              if (player.time >= player.duration - 0.05) player.seek(0);
              player.playing = !player.playing;
            }}
          >
            {player.playing ? '❚❚ PAUSE' : '▶ PLAY'}
          </Button>
          <Button onClick={() => player.seek(0)}>⏮</Button>
          <span className="mono">
            {fmtTime(player.time)} / {fmtTime(player.duration)}
          </span>
          <div className="segmented">
            {[0.5, 1, 2, 4, 8].map((r) => (
              <button key={r} type="button" className={player.rate === r ? 'active' : ''} onClick={() => (player.rate = r)}>
                {r}×
              </button>
            ))}
          </div>
          <div className="segmented">
            {CAMS.map((c) => (
              <button key={c.id} type="button" data-cam={c.id} className={app.camera === c.id ? 'active' : ''} onClick={() => app.set({ camera: c.id })}>
                {c.label}
              </button>
            ))}
          </div>
          <span className="dim small">The coloured line in the sky is your flight path (blue = slow, red = fast).</span>
          <span className="grow" />
          <Button
            onClick={() => {
              void setFlightSaved(rec.id, !saved);
              rec.saved = !saved;
              setSaved(!saved);
            }}
          >
            {saved ? '★ SAVED' : '☆ SAVE FLIGHT'}
          </Button>
          <Button onClick={goBack}>EXIT REPLAY</Button>
        </div>
      </div>
    </div>
  );
}
