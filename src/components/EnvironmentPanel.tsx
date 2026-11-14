/**
 * Weather control panel + Experiment Mode sandbox. Every control writes
 * straight into the running simulation.
 */
import { useEffect, useState } from 'react';
import { sim } from '../game/engine/Simulation';
import { DEFAULT_WEATHER, WEATHER_PRESETS } from '../game/weather/WeatherSystem';
import { useApp } from '../stores/appStore';
import type { WeatherPreset, WeatherState } from '../types';
import { Button, Slider, Toggle } from './ui';

const PRESETS = Object.keys(WEATHER_PRESETS) as Exclude<WeatherPreset, 'custom'>[];

export function EnvironmentPanel() {
  const panel = useApp((s) => s.panel);
  const set = useApp((s) => s.set);
  const [, tick] = useState(0);
  // re-read the live simulation values a few times per second
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  if (!panel) return null;
  const w = sim.weather;
  const t = w.target;
  const s = sim.state;
  const change = (patch: Partial<WeatherState>) => {
    w.set(patch);
    tick((n) => n + 1);
  };
  const hh = Math.floor(w.state.timeOfDay);
  const mm = Math.floor((w.state.timeOfDay % 1) * 60);

  return (
    <aside className="env-panel">
      <div className="env-tabs">
        <button type="button" className={panel === 'weather' ? 'active' : ''} onClick={() => set({ panel: 'weather' })}>
          WEATHER
        </button>
        <button type="button" className={panel === 'experiment' ? 'active' : ''} onClick={() => set({ panel: 'experiment' })}>
          EXPERIMENT
        </button>
        <button type="button" className="close" onClick={() => set({ panel: null })} title="Close (Tab)">
          ×
        </button>
      </div>

      <div className="env-body">
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button key={p} type="button" data-preset={p} className={w.state.preset === p ? 'active' : ''} onClick={() => { w.setPreset(p); tick((n) => n + 1); }} title={WEATHER_PRESETS[p].blurb}>
              {WEATHER_PRESETS[p].label}
            </button>
          ))}
        </div>
        <Slider label="Time of day" value={w.state.timeOfDay} min={0} max={23.99} step={0.05} onChange={(v) => change({ timeOfDay: v })} format={() => `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`} />
        <div className="time-chips">
          {[['Sunrise', 6.2], ['Noon', 12], ['Sunset', 17.8], ['Night', 23]].map(([l, v]) => (
            <button key={l} type="button" onClick={() => change({ timeOfDay: v as number })}>
              {l}
            </button>
          ))}
        </div>
        <Slider label="Wind speed" value={t.windSpeed} min={0} max={35} step={0.5} onChange={(v) => change({ windSpeed: v })} format={(v) => `${v.toFixed(0)} m/s · ${(v * 1.944).toFixed(0)} kt`} />
        <Slider label="Wind from" value={w.state.windDirection} min={0} max={359} step={1} onChange={(v) => change({ windDirection: v })} format={(v) => `${String(Math.round(v)).padStart(3, '0')}°`} hint="Direction the wind blows from. Set it across a runway for a crosswind." />
        <Slider label="Turbulence" value={t.turbulence} min={0} max={1} onChange={(v) => change({ turbulence: v })} format={(v) => `${Math.round(v * 100)}%`} />
        {panel === 'weather' && (
          <>
            <Slider label="Cloud cover" value={t.cloudCover} min={0} max={1} onChange={(v) => change({ cloudCover: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Rain" value={t.rain} min={0} max={1} onChange={(v) => change({ rain: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Fog" value={t.fog} min={0} max={1} onChange={(v) => change({ fog: v })} format={() => `vis ${w.visibility > 9999 ? (w.visibility / 1000).toFixed(0) + ' km' : Math.round(w.visibility) + ' m'}`} />
            <Slider label="Lightning" value={t.lightning} min={0} max={1} onChange={(v) => change({ lightning: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </>
        )}
        {panel === 'experiment' && (
          <>
            <Slider label="Gravity" value={w.state.gravity} min={1} max={25} step={0.1} onChange={(v) => change({ gravity: v })} format={(v) => `${v.toFixed(1)} m/s² · ${(v / 9.80665).toFixed(2)} g`} hint="Moon 1.6 · Mars 3.7 · Earth 9.8 · Jupiter 24.8" />
            <Slider label="Air density" value={w.state.airDensityScale} min={0.2} max={2.5} step={0.01} onChange={(v) => change({ airDensityScale: v })} format={(v) => `${Math.round(v * 100)}% · ${s.airDensity.toFixed(2)} kg/m³`} hint="Scales lift, drag and thrust." />
            <Slider label="Fuel" value={s.fuelFraction} min={0} max={1} onChange={(v) => { sim.model.setFuelFraction(v); tick((n) => n + 1); }} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Damage" value={Math.min(0.99, s.damage)} min={0} max={0.99} onChange={(v) => { sim.model.setDamage(v); tick((n) => n + 1); }} format={(v) => `${Math.round(v * 100)}%`} hint="Damage reduces lift and engine power and adds drag." />
            <Slider label="Clock speed" value={w.state.timeScale} min={0} max={3600} step={10} onChange={(v) => change({ timeScale: v })} format={(v) => (v === 0 ? 'frozen' : `${v}×`)} />
            <Toggle label="Indestructible" value={sim.model.invulnerable} onChange={(v) => { sim.model.invulnerable = v; tick((n) => n + 1); }} />
            <div className="env-readout">
              <span>Lift {(s.lift / 1000).toFixed(1)} kN</span>
              <span>Drag {(s.drag / 1000).toFixed(2)} kN</span>
              <span>Thrust {(s.thrust / 1000).toFixed(2)} kN</span>
              <span>Weight {((sim.model.mass * w.state.gravity) / 1000).toFixed(1)} kN</span>
              <span>AoA {((s.alpha * 180) / Math.PI).toFixed(1)}°</span>
              <span>Slip {((s.beta * 180) / Math.PI).toFixed(1)}°</span>
              <span>Wind {Math.hypot(s.wind.x, s.wind.z).toFixed(1)} m/s</span>
              <span>Updraft {s.wind.y.toFixed(1)} m/s</span>
            </div>
          </>
        )}
        <Button
          onClick={() => {
            const time = w.state.timeOfDay;
            w.reset();
            if (panel === 'weather') w.set({ timeOfDay: time }, true);
            w.setPreset('clear');
            sim.model.invulnerable = false;
            if (panel === 'experiment') {
              sim.model.setFuelFraction(1);
              sim.model.setDamage(0);
              w.set({ timeOfDay: DEFAULT_WEATHER.timeOfDay }, true);
              w.setPreset('clear');
            }
            tick((n) => n + 1);
          }}
        >
          RESET TO DEFAULTS
        </Button>
      </div>
    </aside>
  );
}
