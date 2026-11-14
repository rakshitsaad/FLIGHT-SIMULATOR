import { useEffect, useMemo, useRef, useState } from 'react';
import { goBack, startFlight } from '../app/actions';
import { sim } from '../game/engine/Simulation';
import { makeSample, sampleTerrain, terrainColor } from '../game/terrain/heightfield';
import { AIRPORTS, GATES, HIGHWAYS, LANDMARKS, REGIONS, SPAWNS, runwayFrame } from '../game/world/aerona';
import { useApp } from '../stores/appStore';
import { Button, ScreenFrame } from './ui';

const EXTENT = 34000; // metres from the centre to the map edge
const CENTER_Z = -2000;
const RES = 440;

/** Renders the whole of Aerona from the same terrain function the game flies over. */
function renderMap(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = RES;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(RES, RES);
  const s = makeSample();
  const s2 = makeSample();
  const rgb = new Float32Array(3);
  const step = (EXTENT * 2) / RES;
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const x = -EXTENT + (i + 0.5) * step;
      const z = CENTER_Z - EXTENT + (j + 0.5) * step;
      sampleTerrain(x, z, s);
      const hx = sampleTerrain(x + step, z, s2).h;
      const hz = sampleTerrain(x, z + step, s2).h;
      const sx = (hx - s.h) / step;
      const sz = (hz - s.h) / step;
      const ny = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
      terrainColor(x, z, s, ny, rgb, 0);
      let r = rgb[0];
      let gg = rgb[1];
      let b = rgb[2];
      if (s.h < 0) {
        const d = Math.min(1, -s.h / 30);
        r = 0.16 - 0.1 * d;
        gg = 0.5 - 0.22 * d;
        b = 0.66 - 0.2 * d;
      } else {
        // hill shading from the north-west
        const shade = 0.82 + Math.max(-0.4, Math.min(0.5, (-sx - sz) * 1.6));
        r *= shade;
        gg *= shade;
        b *= shade;
      }
      const o = (j * RES + i) * 4;
      img.data[o] = Math.min(255, Math.pow(r, 0.8) * 255);
      img.data[o + 1] = Math.min(255, Math.pow(gg, 0.8) * 255);
      img.data[o + 2] = Math.min(255, Math.pow(b, 0.8) * 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

let cachedMap: HTMLCanvasElement | null = null;

export function WorldMap() {
  const app = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState(app.spawnId);
  const base = useMemo(() => (cachedMap ??= renderMap()), []);
  const inFlight = app.returnTo === 'flight';

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = c.clientWidth;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = size / (EXTENT * 2);
    const X = (x: number) => (x + EXTENT) * k;
    const Z = (z: number) => (z - CENTER_Z + EXTENT) * k;
    g.imageSmoothingQuality = 'high';
    g.drawImage(base, 0, 0, size, size);
    // highways
    g.strokeStyle = 'rgba(30,30,34,0.75)';
    g.lineWidth = 1.2;
    for (const h of HIGHWAYS) {
      g.beginPath();
      h.points.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      g.stroke();
    }
    // region names
    g.textAlign = 'center';
    g.font = '700 12px system-ui';
    for (const r of REGIONS) {
      g.fillStyle = 'rgba(5,10,16,0.6)';
      const w = g.measureText(r.name).width + 12;
      g.fillRect(X(r.x) - w / 2, Z(r.z) - 9, w, 17);
      g.fillStyle = r.color;
      g.fillText(r.name, X(r.x), Z(r.z) + 4);
    }
    // landmarks
    g.fillStyle = '#ffd98a';
    for (const l of LANDMARKS) {
      g.beginPath();
      g.arc(X(l.x), Z(l.z), 2.4, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#ff9a2e';
    g.lineWidth = 1;
    g.beginPath();
    GATES.forEach((gt, i) => (i ? g.lineTo(X(gt.x), Z(gt.z)) : g.moveTo(X(gt.x), Z(gt.z))));
    g.closePath();
    g.stroke();
    // airports: runway line + code
    for (const a of AIRPORTS) {
      const f = runwayFrame(a);
      const len = Math.max(a.length, 1500) / 2;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(X(a.x - f.ax * len), Z(a.z - f.az * len));
      g.lineTo(X(a.x + f.ax * len), Z(a.z + f.az * len));
      g.stroke();
      g.fillStyle = 'rgba(5,10,16,0.8)';
      g.fillRect(X(a.x) + 6, Z(a.z) - 15, 30, 13);
      g.fillStyle = '#ffffff';
      g.font = '700 10px system-ui';
      g.textAlign = 'left';
      g.fillText(a.code, X(a.x) + 9, Z(a.z) - 5);
    }
    // spawn markers
    for (const s of SPAWNS) {
      const on = s.id === selected;
      g.beginPath();
      g.arc(X(s.x), Z(s.z), on ? 8 : 5, 0, Math.PI * 2);
      g.fillStyle = on ? '#57c7ff' : s.airborne ? 'rgba(255,178,26,0.9)' : 'rgba(255,255,255,0.9)';
      g.fill();
      g.strokeStyle = '#06101a';
      g.lineWidth = 2;
      g.stroke();
    }
    // current aircraft
    if (inFlight) {
      const p = sim.state.position;
      const h = (sim.state.heading * Math.PI) / 180;
      g.save();
      g.translate(X(p.x), Z(p.z));
      g.rotate(h);
      g.fillStyle = '#ff5a4e';
      g.beginPath();
      g.moveTo(0, -11);
      g.lineTo(7, 8);
      g.lineTo(0, 4);
      g.lineTo(-7, 8);
      g.closePath();
      g.fill();
      g.restore();
    }
    // scale bar
    g.fillStyle = '#ffffff';
    g.fillRect(14, size - 20, 10000 * k, 3);
    g.font = '600 10px system-ui';
    g.textAlign = 'left';
    g.fillText('10 km', 14, size - 26);
  }, [base, selected, inFlight]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * EXTENT * 2 - EXTENT;
    const z = ((e.clientY - r.top) / r.height) * EXTENT * 2 - EXTENT + CENTER_Z;
    let best = SPAWNS[0];
    let bd = Infinity;
    for (const s of SPAWNS) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (bd < 4500) setSelected(best.id);
  };
  const spawn = SPAWNS.find((s) => s.id === selected) ?? SPAWNS[0];
  const airport = AIRPORTS.find((a) => a.id === spawn.airportId);

  return (
    <ScreenFrame title="WORLD MAP — AERONA" subtitle="One continuous world. Pick a starting point, or just fly there." onBack={goBack} wide>
      <div className="map-grid">
        <canvas ref={ref} className="map-canvas" onClick={pick} />
        <div className="map-side">
          <h3>Start locations</h3>
          <div className="spawn-list">
            {SPAWNS.map((s) => (
              <button key={s.id} type="button" data-spawn={s.id} className={`spawn ${s.id === selected ? 'active' : ''}`} onClick={() => setSelected(s.id)}>
                <i className={s.airborne ? 'air' : ''} />
                {s.label}
              </button>
            ))}
          </div>
          <div className="map-info">
            <b>{spawn.label}</b>
            {airport ? (
              <p className="dim">
                {airport.kind.toUpperCase()} · {airport.length} m {airport.surface} runway · elevation {airport.elevation} m{airport.lights ? ' · lit' : ''}
              </p>
            ) : (
              <p className="dim">In-flight start at {spawn.altitude} m, engines running.</p>
            )}
          </div>
          <div className="row">
            <Button
              kind="primary"
              onClick={() => {
                app.setSession({ spawnId: selected });
                startFlight({ spawnId: selected });
              }}
            >
              FLY FROM HERE
            </Button>
            {!inFlight && (
              <Button
                onClick={() => {
                  app.setSession({ spawnId: selected });
                  if (!spawn.airborne) sim.preview(app.aircraftId, selected);
                  goBack();
                }}
              >
                SET AS START
              </Button>
            )}
          </div>
          <div className="legend">
            <span>
              <i className="lg-ground" /> Runway start
            </span>
            <span>
              <i className="lg-air" /> Airborne start
            </span>
            <span>
              <i className="lg-lm" /> Landmark
            </span>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}
