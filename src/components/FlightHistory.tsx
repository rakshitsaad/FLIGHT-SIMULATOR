import { useEffect, useState } from 'react';
import { goBack, openReplay } from '../app/actions';
import { AIRCRAFT } from '../game/aircraft/specs';
import { deleteFlight, listFlights, setFlightSaved, type FlightSummary } from '../persistence/db';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import { Button, ScreenFrame, fmtAlt, fmtDist, fmtTime } from './ui';

export function FlightHistory() {
  const [flights, setFlights] = useState<FlightSummary[] | null>(null);
  const [error, setError] = useState('');
  const units = useSettings((s) => s.units);
  const toast = useApp((s) => s.toast);
  const load = () =>
    listFlights()
      .then(setFlights)
      .catch(() => {
        setError('Flight storage is not available in this browser.');
        setFlights([]);
      });
  useEffect(() => {
    void load();
  }, []);
  return (
    <ScreenFrame title="FLIGHT HISTORY" subtitle="Every flight is recorded. Starred flights are kept; the rest roll off after 12." onBack={goBack} wide>
      {flights === null && <p className="dim">Loading…</p>}
      {error && <p className="bad">{error}</p>}
      {flights && flights.length === 0 && !error && <p className="dim">No flights yet. Take off, fly for a while, and your flight will appear here ready to replay.</p>}
      <div className="history">
        {flights?.map((f) => (
          <div className="history-row" key={f.id} data-flight={f.id}>
            <button
              type="button"
              className={`star ${f.saved ? 'on' : ''}`}
              title={f.saved ? 'Saved' : 'Save this flight'}
              onClick={async () => {
                await setFlightSaved(f.id, !f.saved);
                void load();
              }}
            >
              {f.saved ? '★' : '☆'}
            </button>
            <div className="h-main">
              <b>{AIRCRAFT[f.aircraftId].name}</b>
              <span className="dim">
                {new Date(f.createdAt).toLocaleString()} · {f.origin}
              </span>
            </div>
            <div className="h-stats">
              <span>{fmtTime(f.duration)}</span>
              <span>{fmtDist(f.distance, units)}</span>
              <span>max {fmtAlt(f.maxAltitude, units)}</span>
              <span className="chip">{f.controlMode === 'hand' ? '✋ hand' : f.controlMode === 'mixed' ? '✋+⌨' : '⌨ keys'}</span>
              {f.landing ? <span className={`chip grade g-${f.landing.grade}`}>Landing {f.landing.grade} · {f.landing.total}</span> : f.crashed ? <span className="chip bad">Crashed</span> : <span className="chip">No landing</span>}
            </div>
            <Button
              kind="primary"
              onClick={async () => {
                if (!(await openReplay(f.id))) toast('That flight could not be loaded', 'bad');
              }}
            >
              ▶ REPLAY
            </Button>
            <Button
              kind="ghost"
              onClick={async () => {
                await deleteFlight(f.id);
                void load();
              }}
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </ScreenFrame>
  );
}
