import { startFlight } from '../app/actions';
import { AIRCRAFT } from '../game/aircraft/specs';
import { SPAWNS } from '../game/world/aerona';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import { useVisionStatus } from './AirControl';
import { Button } from './ui';

export function MainMenu() {
  const app = useApp();
  const settings = useSettings();
  const vis = useVisionStatus();
  const spawn = SPAWNS.find((s) => s.id === app.spawnId) ?? SPAWNS[0];
  const firstRun = !settings.firstRunDone;
  const handReady = settings.handControl && (vis.calibrated || vis.running);

  const items: { id: string; label: string; hint: string; run: () => void; primary?: boolean }[] = [
    { id: 'fly', label: 'FLY NOW', hint: `${AIRCRAFT[app.aircraftId].name} · ${spawn.label}`, run: () => (firstRun && !settings.handControl ? app.go('aircontrol', 'menu') : startFlight()), primary: true },
    { id: 'hangar', label: 'AIRCRAFT HANGAR', hint: 'Four aircraft, four very different ways to fly', run: () => app.go('hangar', 'menu') },
    { id: 'aircontrol', label: 'AIR CONTROL', hint: handReady ? 'Hand control ready — recalibrate any time' : 'Activate your webcam and calibrate one hand', run: () => app.go('aircontrol', 'menu') },
    { id: 'experiment', label: 'EXPERIMENT MODE', hint: 'Sandbox: gravity, wind, air density, weather, damage', run: () => startFlight({ spawnId: 'air-city', experiment: true }) },
    { id: 'map', label: 'WORLD MAP', hint: 'Choose where in Aerona to start', run: () => app.go('map', 'menu') },
    { id: 'history', label: 'FLIGHT HISTORY', hint: 'Replay and save your flights', run: () => app.go('history', 'menu') },
    { id: 'settings', label: 'SETTINGS', hint: 'Graphics, sound, controls and assists', run: () => app.go('settings', 'menu') },
  ];

  return (
    <div className="menu">
      <div className="menu-brand">
        <div className="brand-mark">ONE-HAND AIR CONTROL</div>
        <h1>SKYBOUND</h1>
        <p className="tagline">YOUR HANDS. YOUR AIRCRAFT. YOUR SKY.</p>
      </div>
      <nav className="menu-items">
        {items.map((it) => (
          <button key={it.id} type="button" data-menu={it.id} className={`menu-item ${it.primary ? 'primary' : ''} ${firstRun && it.id === 'aircontrol' ? 'pulse' : ''}`} onClick={it.run}>
            <span className="mi-label">{it.label}</span>
            <span className="mi-hint">{it.hint}</span>
            {firstRun && it.id === 'aircontrol' && <span className="mi-badge">START HERE</span>}
          </button>
        ))}
      </nav>
      <div className="menu-foot">
        <div className="chips">
          <span className={`chip ${handReady ? 'good' : ''}`}>{handReady ? '✋ Hand control ready' : '⌨ Keyboard control'}</span>
          <span className="chip">{AIRCRAFT[app.aircraftId].className}</span>
        </div>
        <div className="row">
          <Button kind="ghost" onClick={() => startFlight({ academy: true })}>
            60-SECOND AIR CONTROL ACADEMY
          </Button>
          {firstRun && (
            <Button
              kind="ghost"
              onClick={() => {
                settings.set({ firstRunDone: true, handControl: false });
                startFlight();
              }}
            >
              Skip — fly with keyboard
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
