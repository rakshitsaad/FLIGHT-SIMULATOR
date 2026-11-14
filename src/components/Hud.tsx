/**
 * Flight HUD. A single component whose DOM is updated imperatively from the
 * simulation at 30 Hz, so React never re-renders during flight.
 */
import { useEffect, useRef } from 'react';
import { controls } from '../app/ControlRouter';
import { perf } from '../game/engine/GameCanvas';
import { sim } from '../game/engine/Simulation';
import { WEATHER_PRESETS } from '../game/weather/WeatherSystem';
import { nearestAirport } from '../game/world/aerona';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import { vision } from '../vision/VisionService';
import { HandPreview, VirtualJoystick } from './HandWidgets';
import { FT, KT } from './ui';

const CAMERA_LABEL = { cockpit: 'COCKPIT', chase: 'CHASE', cinematic: 'CINEMATIC', instruments: 'INSTRUMENTS' } as const;

export function Hud({ replay = false }: { replay?: boolean }) {
  const camera = useApp((s) => s.camera);
  const handControl = useSettings((s) => s.handControl);
  const showPreview = useSettings((s) => s.showHandPreview);
  const root = useRef<HTMLDivElement>(null);
  const tape = useRef<HTMLCanvasElement>(null);
  const horizon = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = (id: string) => el.querySelector<HTMLElement>(`[data-h="${id}"]`);
    const n = {
      ias: q('ias'), iasU: q('iasU'), alt: q('alt'), altU: q('altU'), vs: q('vs'), agl: q('agl'), hdg: q('hdg'),
      thr: q('thr'), thrBar: q('thrBar'), rpm: q('rpm'), rpmL: q('rpmL'), fuel: q('fuel'), fuelBar: q('fuelBar'), flaps: q('flaps'), gear: q('gear'), brake: q('brake'), ap: q('ap'), g: q('g'),
      warn: q('warn'), nav: q('nav'), region: q('region'), ctl: q('ctl'), fps: q('fps'), wx: q('wx'), dmg: q('dmg'), eng: q('eng'),
    };
    const set = (node: HTMLElement | null, text: string) => {
      if (node && node.textContent !== text) node.textContent = text;
    };
    const cls = (node: HTMLElement | null, name: string, on: boolean) => node?.classList.toggle(name, on);
    let last = 0;
    let id = 0;
    const loop = (now: number) => {
      id = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const units = useSettings.getState().units;
      const av = units === 'aviation';
      const rf = sim.replay?.frame;
      const s = sim.state;
      const spec = sim.mode === 'replay' ? null : sim.spec;
      const ias = replay && rf ? rf.speed : s.indicatedAirspeed;
      const alt = replay && rf ? rf.altitude : s.altitude;
      const vsp = replay && rf ? rf.verticalSpeed : s.verticalSpeed;
      set(n.ias, String(Math.round(av ? ias * KT : ias * 3.6)));
      set(n.iasU, av ? 'KT' : 'KM/H');
      set(n.alt, String(av ? Math.round((alt * FT) / 10) * 10 : Math.round(alt)));
      set(n.altU, av ? 'FT' : 'M');
      const vsv = av ? Math.round((vsp * 196.85) / 50) * 50 : Math.round(vsp * 10) / 10;
      set(n.vs, `${vsv > 0 ? '▲' : vsv < 0 ? '▼' : ''} ${Math.abs(vsv)} ${av ? 'fpm' : 'm/s'}`);
      if (!replay) {
        set(n.agl, `AGL ${av ? Math.round((s.altitudeAgl * FT) / 10) * 10 + ' ft' : Math.round(s.altitudeAgl) + ' m'}`);
        set(n.thr, `${Math.round(s.throttle * 100)}%`);
        if (n.thrBar) n.thrBar.style.width = `${s.enginePower * 100}%`;
        set(n.rpmL, sim.spec.rpmLabel);
        set(n.rpm, sim.spec.engineType === 'jet' ? `${s.rpm.toFixed(0)}` : `${Math.round(s.rpm / 10) * 10}`);
        set(n.fuel, `${Math.round(s.fuelFraction * 100)}%`);
        if (n.fuelBar) n.fuelBar.style.width = `${s.fuelFraction * 100}%`;
        cls(n.fuelBar, 'low', s.fuelFraction < 0.2);
        set(n.flaps, s.flapsNotch === 0 ? 'UP' : `${Math.round(sim.spec.flapNotches[s.flapsNotch] * 30)}°`);
        const transit = s.gear > 0.02 && s.gear < 0.98;
        set(n.gear, transit ? '· · ·' : s.gear >= 0.98 ? 'DOWN' : 'UP');
        cls(n.gear, 'good', s.gear >= 0.98);
        cls(n.gear, 'warn', transit);
        cls(n.brake, 'on', s.brake > 0.3);
        cls(n.ap, 'on', s.autopilot);
        set(n.ap, s.autopilot ? (sim.model.ap.assist ? 'LEVEL ASSIST' : 'AUTOPILOT') : 'A/P OFF');
        set(n.g, `${s.gLoad.toFixed(1)} G`);
        set(n.eng, s.engineRunning ? '' : s.throttle > 0.05 ? 'STARTING…' : 'ENGINE OFF — add throttle to start');
        set(n.dmg, s.damage > 0.02 ? `DAMAGE ${Math.round(s.damage * 100)}%` : '');
        // warnings
        let w = '';
        if (s.stalled) w = 'STALL — lower the nose';
        else if (s.stallWarning) w = 'STALL WARNING';
        else if (s.overspeed) w = 'OVERSPEED';
        else if (!s.onGround && s.altitudeAgl < 150 && s.verticalSpeed < -3 && s.gear < 0.5 && spec && ias < spec.vApproach * 1.5) w = 'GEAR UP';
        else if (!s.onGround && s.altitudeAgl < 60 && s.verticalSpeed < -9) w = 'PULL UP';
        set(n.warn, w);
        cls(n.warn, 'show', w !== '');
        // nav
        const na = nearestAirport(s.position.x, s.position.z);
        const rel = ((na.bearing - s.heading + 540) % 360) - 180;
        const arrow = Math.abs(rel) < 12 ? '↑' : rel > 0 ? (rel > 100 ? '↘' : '→') : rel < -100 ? '↙' : '←';
        set(n.nav, `${arrow} ${na.airport.code} ${String(Math.round(na.bearing)).padStart(3, '0')}° · ${av ? (na.distance / 1852).toFixed(1) + ' nm' : (na.distance / 1000).toFixed(1) + ' km'}`);
        set(n.region, sim.region.toUpperCase().replace('OPENSKY', 'OPEN SKY'));
        // control source
        const vs = vision.controller.snapshot;
        const hc = useSettings.getState().handControl;
        const src = !hc ? 'KEYBOARD' : !vision.status.running ? 'HAND: CAMERA OFF' : vs.status === 'tracking' ? 'HAND CONTROL' : vs.status === 'wrong-hand' ? 'OTHER HAND IN VIEW' : controls.assist ? 'HAND LOST — LEVEL ASSIST' : vs.everTracked ? 'HAND LOST — controls neutral' : 'SHOW YOUR HAND';
        set(n.ctl, src);
        cls(n.ctl, 'good', hc && vs.status === 'tracking');
        cls(n.ctl, 'bad', hc && vision.status.running && vs.status !== 'tracking');
      }
      const hdg = replay ? headingFromView() : s.heading;
      set(n.hdg, String(Math.round(hdg) % 360).padStart(3, '0'));
      set(n.fps, `${Math.round(perf.fps)} fps`);
      const ws = sim.weather.state;
      set(n.wx, `${ws.preset === 'custom' ? 'Custom' : WEATHER_PRESETS[ws.preset].label} · wind ${String(Math.round(ws.windDirection)).padStart(3, '0')}°/${Math.round(av ? ws.windSpeed * KT : ws.windSpeed * 3.6)} ${av ? 'kt' : 'km/h'} · ${String(Math.floor(ws.timeOfDay)).padStart(2, '0')}:${String(Math.floor((ws.timeOfDay % 1) * 60)).padStart(2, '0')}`);
      drawTape(tape.current, hdg);
      drawHorizon(horizon.current, replay ? 0 : s.pitch, replay ? 0 : s.bank, replay);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [replay]);

  return (
    <div className="hud" ref={root}>
      <div className="hud-top">
        <canvas ref={tape} className="hud-tape" width={420} height={38} />
        <div className="hud-hdg">
          <b data-h="hdg">000</b>
        </div>
      </div>
      <div className="hud-topright">
        <span data-h="wx" />
        <span>
          {CAMERA_LABEL[camera]} · <span data-h="fps" />
        </span>
      </div>
      <div className="hud-box hud-speed">
        <span className="lbl">IAS</span>
        <b data-h="ias">0</b>
        <span className="unit" data-h="iasU">
          KT
        </span>
      </div>
      <div className="hud-box hud-alt">
        <span className="lbl">ALT</span>
        <b data-h="alt">0</b>
        <span className="unit" data-h="altU">
          FT
        </span>
        <span className="sub" data-h="vs" />
        {!replay && <span className="sub dim" data-h="agl" />}
      </div>
      {!replay && (
        <>
          <div className="hud-warn" data-h="warn" />
          <div className="hud-center-note">
            <span data-h="eng" />
            <span className="bad" data-h="dmg" />
          </div>
          <canvas ref={horizon} className="hud-horizon" width={150} height={150} />
          <div className="hud-bottom">
            <div className="cell wide">
              <span className="lbl">THROTTLE</span>
              <b data-h="thr">0%</b>
              <i className="bar">
                <i data-h="thrBar" />
              </i>
            </div>
            <div className="cell">
              <span className="lbl" data-h="rpmL">
                RPM
              </span>
              <b data-h="rpm">0</b>
            </div>
            <div className="cell wide">
              <span className="lbl">FUEL</span>
              <b data-h="fuel">100%</b>
              <i className="bar">
                <i className="fuel" data-h="fuelBar" />
              </i>
            </div>
            <div className="cell">
              <span className="lbl">FLAPS</span>
              <b data-h="flaps">UP</b>
            </div>
            <div className="cell">
              <span className="lbl">GEAR</span>
              <b data-h="gear">DOWN</b>
            </div>
            <div className="cell lamp" data-h="brake">
              BRAKE
            </div>
            <div className="cell lamp" data-h="ap">
              A/P OFF
            </div>
            <div className="cell">
              <b data-h="g">1.0 G</b>
            </div>
          </div>
          <div className="hud-nav">
            <b data-h="region">METROPOLIS</b>
            <span data-h="nav" />
          </div>
          <div className="hud-hand">
            <div className="hud-ctl" data-h="ctl">
              KEYBOARD
            </div>
            {handControl && (
              <div className="hud-hand-row">
                {showPreview && <HandPreview className="pip" />}
                <VirtualJoystick size={118} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function headingFromView(): number {
  const q = sim.view.quaternion;
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return ((Math.atan2(fx, -fz) * 180) / Math.PI + 360) % 360;
}

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function drawTape(c: HTMLCanvasElement | null, heading: number): void {
  if (!c) return;
  const g = c.getContext('2d');
  if (!g) return;
  const w = c.width;
  const h = c.height;
  g.clearRect(0, 0, w, h);
  const pxPerDeg = w / 90;
  g.strokeStyle = 'rgba(233,241,248,0.9)';
  g.fillStyle = 'rgba(233,241,248,0.95)';
  g.textAlign = 'center';
  g.font = '600 12px system-ui';
  const start = Math.floor((heading - 46) / 5) * 5;
  for (let d = start; d <= heading + 46; d += 5) {
    const x = w / 2 + (d - heading) * pxPerDeg;
    const dd = ((d % 360) + 360) % 360;
    const big = dd % 10 === 0;
    g.lineWidth = big ? 2 : 1;
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x, h - (big ? 12 : 6));
    g.stroke();
    if (dd % 45 === 0) {
      g.font = '700 14px system-ui';
      g.fillText(CARD[dd / 45], x, 16);
      g.font = '600 12px system-ui';
    } else if (dd % 30 === 0) g.fillText(String(dd / 10).padStart(2, '0'), x, 16);
  }
}

function drawHorizon(c: HTMLCanvasElement | null, pitch: number, bank: number, hidden: boolean): void {
  if (!c || hidden) return;
  const g = c.getContext('2d');
  if (!g) return;
  const w = c.width;
  const r = w / 2 - 3;
  g.clearRect(0, 0, w, w);
  g.save();
  g.beginPath();
  g.arc(w / 2, w / 2, r, 0, Math.PI * 2);
  g.clip();
  g.translate(w / 2, w / 2);
  g.rotate(-bank);
  const off = pitch * 110;
  g.fillStyle = 'rgba(52,130,214,0.78)';
  g.fillRect(-w, -w * 2 + off, w * 2, w * 2);
  g.fillStyle = 'rgba(122,84,48,0.82)';
  g.fillRect(-w, off, w * 2, w * 2);
  g.strokeStyle = '#fff';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-w, off);
  g.lineTo(w, off);
  for (const d of [-20, -10, 10, 20]) {
    const y = off - ((d * Math.PI) / 180) * 110;
    g.moveTo(-14, y);
    g.lineTo(14, y);
  }
  g.stroke();
  g.restore();
  g.strokeStyle = '#ffb21a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w / 2 - 34, w / 2);
  g.lineTo(w / 2 - 12, w / 2);
  g.moveTo(w / 2 + 12, w / 2);
  g.lineTo(w / 2 + 34, w / 2);
  g.stroke();
  g.fillStyle = '#ffb21a';
  g.beginPath();
  g.arc(w / 2, w / 2, 3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(233,241,248,0.6)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(w / 2, w / 2, r, 0, Math.PI * 2);
  g.stroke();
}
