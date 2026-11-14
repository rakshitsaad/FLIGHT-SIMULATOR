/**
 * AIR CONTROL — webcam activation and the step-by-step hand calibration.
 *
 *  1 permission → 2 live preview → 3 detect one hand → 4 skeleton overlay →
 *  5 neutral → 6 roll range → 7 pitch range → 8 wrist rotation →
 *  9 throttle open / fist → 10 gesture check → 11 save & fly
 */
import { useEffect, useRef, useState } from 'react';
import { goBack, startFlight } from '../app/actions';
import { audio } from '../audio/AudioEngine';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import type { GestureName } from '../types';
import { CALIBRATION_STEPS, CalibrationSession } from '../vision/calibration/calibration';
import { vision, type VisionStatus } from '../vision/VisionService';
import { HandPreview, VirtualJoystick } from './HandWidgets';
import { Button, ScreenFrame, Segmented } from './ui';

export function useVisionStatus(): VisionStatus {
  const [status, setStatus] = useState<VisionStatus>({ ...vision.status });
  useEffect(() => vision.subscribe(setStatus), []);
  return status;
}

interface Live {
  tracking: string;
  confidence: number;
  advice: string | null;
  step: number;
  progress: number;
  hint: string;
  a: number;
  b: number;
  pinch: boolean;
  thumbs: boolean;
  victory: boolean;
  gesture: string | null;
  seenHand: string | null;
}

const GESTURE_LABEL: Record<GestureName, string> = { pinch: 'Pinch', thumbsUp: 'Thumbs up', victory: 'Victory', fist: 'Fist' };

export function AirControl() {
  const status = useVisionStatus();
  const settings = useSettings();
  const returnTo = useApp((s) => s.returnTo);
  const session = useRef<CalibrationSession | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [done, setDone] = useState(false);
  const [live, setLive] = useState<Live>({ tracking: 'off', confidence: 0, advice: null, step: 0, progress: 0, hint: '', a: 0, b: 0, pinch: false, thumbs: false, victory: false, gesture: null, seenHand: null });
  const lastGesture = useRef<{ name: GestureName; at: number } | null>(null);

  // feed the calibration session at the vision rate; mirror its state into React at ~12 Hz
  useEffect(() => {
    let last = performance.now();
    let n = 0;
    const prev = vision.controller.onGesture;
    vision.controller.onGesture = (g) => {
      prev(g);
      lastGesture.current = { name: g, at: performance.now() };
      session.current?.noteGesture(g);
    };
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      // (the render loop advances the controller every frame; here we only read it)
      const snap = vision.controller.snapshot;
      const s = session.current;
      if (s && !s.finished) {
        const tracking = snap.status === 'tracking' && snap.landmarks;
        if (tracking && snap.landmarks) s.noteHand(snap.landmarks.handedness);
        s.update(tracking ? snap.features : null, now / 1000, dt);
        if (s.finished) {
          void vision.saveCalibration(s.result);
          useSettings.getState().set({ handControl: true });
          setCalibrating(false);
          setDone(true);
          audio.gestureTick();
        }
      }
      if (++n % 2 === 0) {
        const lg = lastGesture.current;
        setLive({
          tracking: snap.status,
          confidence: snap.confidence,
          advice: snap.advice,
          step: s ? s.stepIndex : 0,
          progress: s ? s.progress : 0,
          hint: s ? s.hint : '',
          a: s ? s.extentA : 0,
          b: s ? s.extentB : 0,
          pinch: !!s?.gesturesSeen.pinch,
          thumbs: !!s?.gesturesSeen.thumbsUp,
          victory: !!s?.gesturesSeen.victory,
          gesture: lg && now - lg.at < 1500 ? GESTURE_LABEL[lg.name] : snap.gesture.active ? `${GESTURE_LABEL[snap.gesture.active]}…` : null,
          seenHand: snap.landmarks?.handedness ?? null,
        });
      }
    }, 40);
    return () => {
      clearInterval(id);
      vision.controller.onGesture = prev;
    };
  }, []);

  const enable = () => {
    audio.unlock();
    void vision.start();
  };
  const begin = () => {
    vision.controller.lockHand(null);
    session.current = new CalibrationSession(settings.hand, vision.camera.aspect);
    setDone(false);
    setCalibrating(true);
  };
  const quick = () => {
    void vision.clearCalibration(settings.hand);
    settings.set({ handControl: true });
    setDone(true);
    setCalibrating(false);
    session.current = null;
  };

  const camOk = status.camera === 'live';
  const failed = ['denied', 'no-camera', 'in-use', 'insecure', 'unsupported', 'error'].includes(status.camera);
  const trackerFailed = status.tracker === 'error';
  const step = CALIBRATION_STEPS[live.step];
  const rangeStep = step && (step.id === 'roll' || step.id === 'pitch' || step.id === 'wrist');
  const labels = step?.id === 'roll' ? ['LEFT', 'RIGHT'] : step?.id === 'pitch' ? ['DOWN', 'UP'] : ['ANTICLOCKWISE', 'CLOCKWISE'];

  return (
    <ScreenFrame
      title="AIR CONTROL"
      subtitle="Fly with one hand. Your webcam picture is processed on this device and never leaves it."
      onBack={goBack}
      wide
      actions={
        <Segmented
          label="Flying hand"
          value={settings.hand}
          options={[
            { value: 'Left', label: 'Left' },
            { value: 'Right', label: 'Right' },
          ]}
          onChange={(hand) => {
            settings.set({ hand });
            vision.controller.lockHand(null);
          }}
        />
      }
    >
      <div className="aircontrol">
        <section className="ac-camera">
          <div className="ac-preview">
            <HandPreview />
            {!camOk && (
              <div className="ac-overlay">
                {status.camera === 'idle' && (
                  <>
                    <h3>Step 1 — turn on your webcam</h3>
                    <p>SKYBOUND tracks 21 points on one hand to steer the aircraft. Nothing is recorded or uploaded.</p>
                    <Button kind="primary" onClick={enable}>
                      ENABLE CAMERA
                    </Button>
                  </>
                )}
                {status.camera === 'requesting' && (
                  <>
                    <h3>Waiting for permission…</h3>
                    <p>Choose “Allow” in your browser’s camera prompt.</p>
                  </>
                )}
                {failed && (
                  <>
                    <h3>Camera unavailable</h3>
                    <p>{status.cameraMessage}</p>
                    <div className="row">
                      <Button kind="primary" onClick={enable}>
                        TRY AGAIN
                      </Button>
                      <Button
                        onClick={() => {
                          settings.set({ handControl: false });
                          startFlight();
                        }}
                      >
                        FLY WITH KEYBOARD
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
            {camOk && status.tracker === 'loading' && (
              <div className="ac-overlay soft">
                <h3>Loading hand tracking…</h3>
              </div>
            )}
            {camOk && trackerFailed && (
              <div className="ac-overlay">
                <h3>Hand tracking could not start</h3>
                <p>{status.trackerError}</p>
                <Button kind="primary" onClick={enable}>
                  RETRY
                </Button>
              </div>
            )}
          </div>
          <div className="ac-stats">
            <Stat label="Camera" value={camOk ? 'LIVE' : status.camera.toUpperCase()} tone={camOk ? 'good' : failed ? 'bad' : 'dim'} />
            <Stat label="Tracking" value={live.tracking === 'wrong-hand' ? 'OTHER HAND' : live.tracking.toUpperCase()} tone={live.tracking === 'tracking' ? 'good' : live.tracking === 'lost' ? 'bad' : 'warn'} />
            <Stat label="Confidence" value={live.tracking === 'tracking' ? `${Math.round(live.confidence * 100)}%` : '—'} />
            <Stat label="Detection" value={status.running ? `${status.fps} fps` : '—'} tone={status.running && status.fps < 12 ? 'warn' : undefined} />
            <Stat label="Inference" value={status.running ? `${status.inferMs.toFixed(0)} ms` : '—'} />
            <Stat label="Engine" value={status.backend || '—'} />
            <Stat label="Light" value={status.brightness < 0 ? '—' : status.lowLight ? 'TOO DARK' : 'OK'} tone={status.lowLight ? 'warn' : undefined} />
            <Stat label="Hand seen" value={live.seenHand ?? '—'} />
          </div>
          {(status.lowLight || live.advice || live.tracking === 'wrong-hand') && camOk && (
            <div className="ac-advice">
              {status.lowLight && <span>💡 The picture is dark — add light in front of you for steadier tracking. </span>}
              {live.advice && <span>✋ {live.advice}. </span>}
              {live.tracking === 'wrong-hand' && <span>↔ A different hand than the calibrated one is showing. Use the calibrated hand, or recalibrate.</span>}
            </div>
          )}
        </section>

        <section className="ac-side">
          <div className="ac-card">
            <div className="ac-card-head">
              <h3>{calibrating && step ? `Step ${live.step + 5} of 11 — ${step.title}` : done || status.calibrated ? 'Hand control ready' : 'Calibration'}</h3>
              {calibrating && <span className="pill">{Math.round(live.progress * 100)}%</span>}
            </div>

            {!calibrating && !camOk && <p className="dim">Enable the camera to begin. You can also fly with the keyboard at any time.</p>}

            {!calibrating && camOk && !(done || status.calibrated) && (
              <>
                <p>
                  {live.tracking === 'tracking'
                    ? 'One hand detected — the skeleton overlay shows what the tracker sees. Calibration takes about 30 seconds.'
                    : 'Show one open hand to the camera, about 40–60 cm away, palm facing the screen.'}
                </p>
                <div className="row">
                  <Button kind="primary" onClick={begin} disabled={!status.running}>
                    START CALIBRATION
                  </Button>
                  <Button onClick={quick} disabled={!status.running} title="Skip the wizard: the first steady hand position becomes neutral">
                    QUICK SETUP
                  </Button>
                </div>
              </>
            )}

            {calibrating && step && (
              <>
                <p className="ac-instruction">{step.instruction}</p>
                <div className="ac-progress">
                  <i style={{ width: `${Math.round(live.progress * 100)}%` }} />
                </div>
                <p className="ac-hint">{live.hint || ' '}</p>
                {rangeStep && (
                  <div className="ac-extents">
                    <div>
                      <span>{labels[0]}</span>
                      <b>
                        <i style={{ width: `${live.a * 100}%` }} />
                      </b>
                    </div>
                    <div>
                      <span>{labels[1]}</span>
                      <b>
                        <i style={{ width: `${live.b * 100}%` }} />
                      </b>
                    </div>
                  </div>
                )}
                {step.id === 'gestures' && (
                  <ul className="ac-gestures">
                    <li className={live.pinch ? 'ok' : ''}>🤏 Pinch — landing gear</li>
                    <li className={live.thumbs ? 'ok' : ''}>👍 Thumbs up — autopilot</li>
                    <li className={live.victory ? 'ok' : 'opt'}>✌️ Victory — flaps (optional)</li>
                    <li className="opt">✊ Tight fist held 2 s — emergency pause</li>
                  </ul>
                )}
                <div className="row">
                  <Button
                    onClick={() => {
                      const s = session.current;
                      if (!s) return;
                      s.next();
                      if (s.finished) {
                        void vision.saveCalibration(s.result);
                        settings.set({ handControl: true });
                        setCalibrating(false);
                        setDone(true);
                      }
                    }}
                    title="Keep the default for this step"
                  >
                    SKIP STEP
                  </Button>
                  <Button kind="ghost" onClick={() => session.current?.back()}>
                    ← PREVIOUS
                  </Button>
                  <Button
                    kind="ghost"
                    onClick={() => {
                      session.current = null;
                      setCalibrating(false);
                    }}
                  >
                    CANCEL
                  </Button>
                </div>
              </>
            )}

            {!calibrating && camOk && (done || status.calibrated) && (
              <>
                <p>
                  {status.calibrated ? 'Calibration saved on this device.' : 'Quick setup active: your first steady hand position is used as neutral.'} Move your hand and watch the joystick — this is exactly what the aircraft will receive.
                </p>
                <div className="row">
                  <Button kind="primary" onClick={() => (returnTo === 'flight' ? goBack() : startFlight())}>
                    {returnTo === 'flight' ? 'BACK TO FLIGHT' : 'SAVE & FLY'}
                  </Button>
                  <Button onClick={begin}>RECALIBRATE</Button>
                  <Button kind="ghost" onClick={() => startFlight({ academy: true })}>
                    60-SECOND ACADEMY
                  </Button>
                </div>
              </>
            )}

            <ol className="ac-steps">
              {['Camera permission', 'Live preview', 'Detect one hand', 'Skeleton overlay'].map((t, i) => {
                const ok = i === 0 ? camOk : i === 1 ? camOk : status.running && live.tracking === 'tracking';
                return (
                  <li key={t} className={ok ? 'ok' : ''}>
                    {t}
                  </li>
                );
              })}
              {CALIBRATION_STEPS.slice(0, 7).map((s, i) => (
                <li key={s.id} className={status.calibrated && !calibrating ? 'ok' : calibrating && live.step > i ? 'ok' : calibrating && live.step === i ? 'now' : ''}>
                  {s.title}
                </li>
              ))}
            </ol>
          </div>

          <div className="ac-card ac-live">
            <div className="ac-card-head">
              <h3>Virtual joystick</h3>
              {live.gesture && <span className="pill warn">{live.gesture}</span>}
            </div>
            <VirtualJoystick size={170} />
            <p className="dim small">
              Hand left/right = roll · up/down = pitch · rotate wrist = rudder · open hand = idle, closed hand = full throttle. The hollow ring is your raw hand position; the dot is the filtered
              control output. Orange disc = dead zone.
            </p>
          </div>
        </section>
      </div>
    </ScreenFrame>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
