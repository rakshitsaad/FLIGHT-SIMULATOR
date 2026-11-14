import { goBack, startFlight } from '../app/actions';
import { AIRCRAFT, AIRCRAFT_ORDER, stallSpeeds } from '../game/aircraft/specs';
import { worldRef } from '../game/engine/GameCanvas';
import { sim } from '../game/engine/Simulation';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import type { AircraftId } from '../types';
import { Button, ScreenFrame, fmtSpeed } from './ui';

const STAT_LABELS: [keyof (typeof AIRCRAFT)['trainer']['stats'], string][] = [
  ['speed', 'Speed'],
  ['agility', 'Agility'],
  ['stability', 'Stability'],
  ['range', 'Endurance'],
  ['stol', 'Short-field'],
];

export function Hangar() {
  const app = useApp();
  const units = useSettings((s) => s.units);
  const spec = AIRCRAFT[app.aircraftId];
  const vs = stallSpeeds(spec);
  const select = (id: AircraftId) => {
    app.setSession({ aircraftId: id });
    sim.preview(id, app.spawnId);
    worldRef.current?.rig.snap();
  };
  const power = spec.engineType === 'jet' ? `${Math.round(spec.staticThrust / 1000)} kN thrust` : `${Math.round(spec.maxPower / 745.7)} hp${spec.engineCount > 1 ? ` (${spec.engineCount} engines)` : ''}`;
  return (
    <div className="hangar">
      <ScreenFrame title="AIRCRAFT HANGAR" subtitle="Each aircraft has its own mass, engine, wing and stall behaviour." onBack={goBack} wide>
        <div className="hangar-grid">
          <div className="hangar-list">
            {AIRCRAFT_ORDER.map((id) => {
              const a = AIRCRAFT[id];
              return (
                <button key={id} type="button" data-aircraft={id} className={`hangar-item ${id === app.aircraftId ? 'active' : ''}`} onClick={() => select(id)}>
                  <b>{a.name}</b>
                  <span>{a.className}</span>
                </button>
              );
            })}
          </div>
          <div className="hangar-spacer" />
          <div className="hangar-detail">
            <h2>{spec.name}</h2>
            <div className="dim">{spec.className}</div>
            <p>{spec.description}</p>
            <div className="chips">
              {spec.traits.map((t) => (
                <span className="chip" key={t}>
                  {t}
                </span>
              ))}
              {spec.amphibious && <span className="chip good">Amphibious</span>}
            </div>
            <div className="bars">
              {STAT_LABELS.map(([k, label]) => (
                <div key={k} className="bar-row">
                  <span>{label}</span>
                  <b>
                    <i style={{ width: `${spec.stats[k] * 100}%` }} />
                  </b>
                </div>
              ))}
            </div>
            <dl className="specs">
              <dt>Max weight</dt>
              <dd>{(spec.emptyMass + spec.fuelCapacity).toLocaleString()} kg</dd>
              <dt>Power</dt>
              <dd>{power}</dd>
              <dt>Wing</dt>
              <dd>
                {spec.wingSpan.toFixed(1)} m span · {spec.wingArea.toFixed(1)} m²
              </dd>
              <dt>Stall (clean / landing)</dt>
              <dd>
                {fmtSpeed(vs.clean, units)} / {fmtSpeed(vs.landing, units)}
              </dd>
              <dt>Approach speed</dt>
              <dd>{fmtSpeed(spec.vApproach, units)}</dd>
              <dt>Never exceed</dt>
              <dd>{fmtSpeed(spec.vne, units)}</dd>
              <dt>Fuel</dt>
              <dd>{spec.fuelCapacity} kg</dd>
            </dl>
            <div className="row">
              <Button kind="primary" onClick={() => startFlight()}>
                FLY THIS AIRCRAFT
              </Button>
              <Button onClick={() => app.go('map', 'hangar')}>CHOOSE LOCATION</Button>
            </div>
          </div>
        </div>
      </ScreenFrame>
    </div>
  );
}
