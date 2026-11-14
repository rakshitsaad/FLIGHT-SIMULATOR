/**
 * AIR CONTROL ACADEMY — a one-minute lesson. Each step completes only when
 * the simulator actually receives that control input, then finishes with a
 * real take-off.
 */
import { useEffect, useRef, useState } from 'react';
import { controls } from '../app/ControlRouter';
import { audio } from '../audio/AudioEngine';
import { sim } from '../game/engine/Simulation';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import { vision } from '../vision/VisionService';
import { Button } from './ui';

interface Lesson {
  title: string;
  hand: string;
  keys: string;
}

const LESSONS: Lesson[] = [
  { title: 'Show your flying hand', hand: 'Hold one open hand up to the camera until it is tracked.', keys: 'Keyboard mode — press any arrow key to begin.' },
  { title: 'Roll', hand: 'Move your hand LEFT, then RIGHT. Watch the ailerons on the wings.', keys: 'Press A then D (or ← then →).' },
  { title: 'Pitch', hand: 'Move your hand UP, then DOWN. Watch the elevator on the tail.', keys: 'Press S then W (or ↓ then ↑).' },
  { title: 'Rudder', hand: 'Rotate your wrist like turning a dial, either way.', keys: 'Press Q or E.' },
  { title: 'Throttle', hand: 'Close your hand into a loose fist — full power. The engine starts and the brakes release.', keys: 'Hold Shift until the throttle reads 100%.' },
  { title: 'Take off', hand: 'Stay centred. When the speed passes 60 kt, raise your hand gently and climb away.', keys: 'At 60 kt hold S (or ↓) gently and climb away.' },
  { title: 'Gear up', hand: 'Pinch thumb and index finger together to retract the landing gear.', keys: 'Press G to retract the landing gear.' },
];

export function Academy() {
  const academy = useApp((s) => s.academy);
  const set = useApp((s) => s.set);
  const handControl = useSettings((s) => s.handControl);
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const flags = useRef({ a: false, b: false, start: 0, stepRef: 0 });

  useEffect(() => {
    if (!academy) return;
    const f = flags.current;
    f.a = f.b = false;
    f.start = performance.now();
    f.stepRef = 0;
    setStep(0);
    setFinished(false);
    const id = setInterval(() => {
      const i = controls.current;
      const s = sim.state;
      let done = false;
      switch (f.stepRef) {
        case 0:
          done = useSettings.getState().handControl ? vision.controller.snapshot.status === 'tracking' : Math.abs(i.pitch) + Math.abs(i.roll) > 0.2;
          break;
        case 1:
          if (i.roll < -0.5) f.a = true;
          if (i.roll > 0.5) f.b = true;
          done = f.a && f.b;
          break;
        case 2:
          if (i.pitch > 0.5) f.a = true;
          if (i.pitch < -0.5) f.b = true;
          done = f.a && f.b;
          break;
        case 3:
          done = Math.abs(i.yaw) > 0.5;
          break;
        case 4:
          done = i.throttle > 0.9;
          break;
        case 5:
          done = !s.onGround && s.altitudeAgl > 25;
          break;
        case 6:
          done = !s.gearDown;
          break;
      }
      if (sim.mode === 'crashed') {
        f.stepRef = 0;
        setStep(0);
      }
      if (done) {
        f.a = f.b = false;
        audio.gestureTick();
        if (f.stepRef >= LESSONS.length - 1) {
          setFinished(true);
          clearInterval(id);
        } else {
          f.stepRef++;
          setStep(f.stepRef);
        }
      }
      setElapsed((performance.now() - f.start) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [academy]);

  if (!academy) return null;
  const l = LESSONS[step];
  return (
    <div className="academy">
      <div className="academy-head">
        <b>AIR CONTROL ACADEMY</b>
        <span className="mono">{elapsed.toFixed(0)} s</span>
        <button type="button" onClick={() => set({ academy: false })} title="Leave the lesson and keep flying">
          ×
        </button>
      </div>
      {finished ? (
        <>
          <h3>You are flying — in {elapsed.toFixed(0)} seconds.</h3>
          <p>Explore Aerona freely. Thumbs-up engages the autopilot, a victory sign sets flaps for landing, and a tight fist held for two seconds pauses.</p>
          <Button kind="primary" onClick={() => set({ academy: false })}>
            CONTINUE FLYING
          </Button>
        </>
      ) : (
        <>
          <h3>
            {step + 1}. {l.title}
          </h3>
          <p>{handControl ? l.hand : l.keys}</p>
          <div className="dots">
            {LESSONS.map((_, i) => (
              <i key={i} className={i < step ? 'ok' : i === step ? 'now' : ''} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
