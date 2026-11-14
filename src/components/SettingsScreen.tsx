import { goBack } from '../app/actions';
import { DEFAULT_SETTINGS, useSettings } from '../stores/settingsStore';
import { useApp } from '../stores/appStore';
import { vision } from '../vision/VisionService';
import { Button, ScreenFrame, Segmented, Slider, Toggle } from './ui';

export function SettingsScreen() {
  const s = useSettings();
  const app = useApp();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <ScreenFrame title="SETTINGS" onBack={goBack} wide actions={<Button onClick={() => s.reset()}>RESET ALL</Button>}>
      <div className="settings-grid">
        <section>
          <h3>Graphics</h3>
          <Segmented
            label="Quality"
            value={s.graphics}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
            onChange={(graphics) => s.set({ graphics })}
          />
          <p className="dim small">Low: 14 km view, no shadows. Medium: 20 km, shadows. High: 27 km, denser terrain, forests and clouds. Resolution scales down automatically if the frame rate drops.</p>
          <Segmented
            label="Units"
            value={s.units}
            options={[
              { value: 'aviation', label: 'kt · ft' },
              { value: 'metric', label: 'km/h · m' },
            ]}
            onChange={(units) => s.set({ units })}
          />
          <Segmented
            label="Starting camera"
            value={s.defaultCamera}
            options={[
              { value: 'chase', label: 'Chase' },
              { value: 'cockpit', label: 'Cockpit' },
            ]}
            onChange={(defaultCamera) => s.set({ defaultCamera })}
          />
          <h3>Sound</h3>
          <Toggle label="Mute" value={s.muted} onChange={(muted) => s.set({ muted })} />
          <Slider label="Master" value={s.masterVolume} min={0} max={1} onChange={(v) => s.set({ masterVolume: v })} format={pct} />
          <Slider label="Engine" value={s.engineVolume} min={0} max={1} onChange={(v) => s.set({ engineVolume: v })} format={pct} />
          <Slider label="Wind & world" value={s.ambienceVolume} min={0} max={1} onChange={(v) => s.set({ ambienceVolume: v })} format={pct} />
          <h3>Flight assists</h3>
          <Toggle label="Auto-trim (centred stick holds level flight)" value={s.autoTrim} onChange={(autoTrim) => s.set({ autoTrim })} hint="Applies from the next flight" />
          <Toggle label="Stall protection (stick pusher)" value={s.stallProtection} onChange={(stallProtection) => s.set({ stallProtection })} hint="Holding the stick fully back gives maximum lift instead of a stall. Turn off for raw stalls and spins. Applies from the next flight" />
          <Toggle label="Auto engine start with throttle" value={s.autoStart} onChange={(autoStart) => s.set({ autoStart })} hint="Applies from the next flight" />
        </section>
        <section>
          <h3>One-hand control</h3>
          <Toggle label="Fly with hand tracking" value={s.handControl} onChange={(handControl) => { s.set({ handControl }); if (handControl) void vision.start(); }} />
          <div className="row">
            <Button onClick={() => app.go('aircontrol', app.returnTo === 'flight' ? 'flight' : 'settings')}>OPEN AIR CONTROL / RECALIBRATE</Button>
          </div>
          <Segmented
            label="Flying hand"
            value={s.hand}
            options={[
              { value: 'Left', label: 'Left' },
              { value: 'Right', label: 'Right' },
            ]}
            onChange={(hand) => { s.set({ hand }); vision.controller.lockHand(null); }}
          />
          <Toggle label="Ignore the other hand" value={s.enforceHand} onChange={(enforceHand) => s.set({ enforceHand })} hint="Only the hand you calibrated with can fly the aircraft" />
          <Slider label="Sensitivity" value={s.sensitivity} min={0.4} max={2.5} step={0.05} onChange={(v) => s.set({ sensitivity: v })} format={(v) => `${v.toFixed(2)}×`} hint="How much stick you get per centimetre of hand travel" />
          <Slider label="Rudder sensitivity" value={s.yawSensitivity} min={0.3} max={2.5} step={0.05} onChange={(v) => s.set({ yawSensitivity: v })} format={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Dead zone" value={s.deadZone} min={0} max={0.35} step={0.01} onChange={(v) => s.set({ deadZone: v })} format={pct} hint="Hand movement ignored around neutral" />
          <Slider label="Rudder dead zone" value={s.yawDeadZone} min={0.05} max={0.5} step={0.01} onChange={(v) => s.set({ yawDeadZone: v })} format={pct} />
          <Slider label="Smoothing" value={s.smoothing} min={0} max={1} step={0.05} onChange={(v) => s.set({ smoothing: v })} format={pct} hint="More smoothing = steadier but slightly slower response" />
          <Slider label="Soft centre" value={s.expo} min={0} max={0.8} step={0.05} onChange={(v) => s.set({ expo: v })} format={pct} hint="Finer control near neutral" />
          <Toggle label="Invert pitch (hand up = nose down)" value={s.invertPitch} onChange={(invertPitch) => s.set({ invertPitch })} />
          <Toggle label="Gestures (pinch, thumbs-up, victory, fist)" value={s.gestures} onChange={(gestures) => s.set({ gestures })} />
          <Slider label="Fist-hold pause" value={s.fistPauseSeconds} min={0} max={4} step={0.5} onChange={(v) => s.set({ fistPauseSeconds: v })} format={(v) => (v === 0 ? 'off' : `${v.toFixed(1)} s`)} />
          <Toggle label="Brake when the hand is open on the ground" value={s.autoBrake} onChange={(autoBrake) => s.set({ autoBrake })} />
          <Toggle label="Hold level flight if the hand is lost" value={s.lostHandAssist} onChange={(lostHandAssist) => s.set({ lostHandAssist })} />
          <Toggle label="Show webcam preview while flying" value={s.showHandPreview} onChange={(showHandPreview) => s.set({ showHandPreview })} />
          <h3>Computer vision</h3>
          <Slider label="Tracking rate" value={s.visionFps} min={10} max={45} step={1} onChange={(v) => s.set({ visionFps: v })} format={(v) => `${v} fps`} hint="Hand-tracking inferences per second" />
          <Segmented
            label="Processor"
            value={s.visionDelegate}
            options={[
              { value: 'GPU', label: 'GPU' },
              { value: 'CPU', label: 'CPU' },
            ]}
            onChange={(visionDelegate) => s.set({ visionDelegate })}
          />
          <Toggle label="Run tracking in a Web Worker" value={s.visionWorker} onChange={(visionWorker) => s.set({ visionWorker })} hint="Keeps the 3D view smooth while tracking runs" />
          <p className="dim small">Hand tracking runs entirely in your browser with MediaPipe. The camera picture is never stored or sent anywhere.</p>
        </section>
      </div>
      <p className="dim small">Defaults: sensitivity {DEFAULT_SETTINGS.sensitivity}× · dead zone {Math.round(DEFAULT_SETTINGS.deadZone * 100)}% · tracking {DEFAULT_SETTINGS.visionFps} fps.</p>
    </ScreenFrame>
  );
}
