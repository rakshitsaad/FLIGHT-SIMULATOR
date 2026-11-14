// Dev-only harness: runs the real camera → MediaPipe → controller pipeline and
// exposes its state for the browser tests.
import { vision } from '../../src/vision/VisionService';
import { DEFAULT_HAND_SETTINGS } from '../../src/vision/SingleHandFlightController';

const params = new URLSearchParams(location.search);
const log: any[] = [];
const cmds: string[] = [];
(window as any).visionLog = log;
(window as any).visionCmds = cmds;
(window as any).vision = vision;

vision.configure(
  { ...DEFAULT_HAND_SETTINGS, enforceHand: params.get('enforce') !== '0', hand: (params.get('hand') as any) ?? 'Right' },
  { delegate: (params.get('delegate') as any) ?? 'GPU', useWorker: params.get('worker') !== '0', fps: Number(params.get('fps') ?? 24) },
);
vision.controller.onCommand = (c) => cmds.push(c);
const t0 = performance.now();
let last = t0;
function loop() {
  const now = performance.now();
  const input = vision.controller.update((now - last) / 1000, now);
  last = now;
  const s = vision.controller.snapshot;
  log.push({
    t: +((now - t0) / 1000).toFixed(2),
    st: s.status,
    roll: +input.roll.toFixed(3),
    pitch: +input.pitch.toFixed(3),
    yaw: +input.yaw.toFixed(3),
    thr: +input.throttle.toFixed(3),
    closure: +s.closure.toFixed(3),
    open: +s.features.openness.toFixed(3),
    px: +s.features.palmCenter.x.toFixed(3),
    py: +s.features.palmCenter.y.toFixed(3),
    ang: +s.features.wristAngle.toFixed(3),
    scale: +s.features.handScale.toFixed(3),
    curl: s.features.fingerCurl.map((c) => +c.toFixed(2)),
    ti: +s.features.thumbIndexDistance.toFixed(2),
    tuck: +s.features.thumbTuck.toFixed(2),
    tdy: +s.features.thumbDirection.y.toFixed(2),
    prom: +s.features.thumbProminence.toFixed(2),
    g: s.gesture.active,
    gp: +s.gesture.progress.toFixed(2),
    hand: s.landmarks?.handedness ?? null,
    conf: +s.confidence.toFixed(2),
  });
  document.getElementById('out')!.textContent = JSON.stringify({ status: vision.status, last: log[log.length - 1], cmds }, null, 1);
  setTimeout(loop, 1000 / 30);
}
vision.start().then((ok) => {
  (window as any).visionStarted = ok;
  loop();
});
