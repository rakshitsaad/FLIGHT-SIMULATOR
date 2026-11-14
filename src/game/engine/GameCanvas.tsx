/**
 * The React Three Fiber host. React only mounts the canvas; each frame the
 * render loop (1) gathers input, (2) advances the fixed-step simulation and
 * (3) lets the WorldScene read the interpolated result.
 */
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, type PerspectiveCamera } from 'three';
import { controls } from '../../app/ControlRouter';
import { useApp } from '../../stores/appStore';
import { GRAPHICS, useSettings, type GraphicsConfig } from '../../stores/settingsStore';
import type { RigMode } from '../cameras/CameraRig';
import { WorldScene } from '../world/WorldScene';
import { audio } from '../../audio/AudioEngine';
import { sim } from './Simulation';

/** Live handle for the HUD, replay UI and tests. */
export const worldRef: { current: WorldScene | null } = { current: null };
export const perf = { fps: 60, frameMs: 16, drawCalls: 0, triangles: 0 };

function World({ cfg }: { cfg: GraphicsConfig }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const world = useRef<WorldScene | null>(null);
  const acc = useRef({ t: 0, n: 0 });

  useEffect(() => {
    const w = new WorldScene(scene, camera, cfg);
    world.current = w;
    worldRef.current = w;
    return () => {
      w.dispose();
      world.current = null;
      worldRef.current = null;
    };
  }, [scene, camera, cfg]);

  useFrame((_, delta) => {
    const w = world.current;
    if (!w) return;
    const dt = Math.min(delta, 0.1);
    const app = useApp.getState();
    sim.paused = app.paused && app.screen === 'flight';
    controls.frame(dt);
    sim.update(dt);

    let mode: RigMode = 'orbit';
    if (app.screen === 'flight') mode = sim.mode === 'crashed' ? 'wreck' : app.camera;
    else if (app.screen === 'replay') mode = app.camera;
    w.rig.orbitDistance = app.screen === 'hangar' ? 0.85 : 1.25;
    w.setFlightPath(app.screen === 'replay' && sim.replay ? sim.replay.record : null);
    w.update(dt, camera, mode);
    audio.update(dt, camera.position, camera.quaternion, mode, (app.screen === 'flight' && !app.paused) || app.screen === 'replay');

    if (app.loading && w.terrain.ready) app.set({ loading: false });

    const a = acc.current;
    a.t += delta;
    a.n++;
    if (a.t >= 0.5) {
      perf.fps = a.n / a.t;
      perf.frameMs = (a.t / a.n) * 1000;
      perf.drawCalls = gl.info.render.calls;
      perf.triangles = gl.info.render.triangles;
      a.t = 0;
      a.n = 0;
    }
  });
  return null;
}

export function GameCanvas() {
  const graphics = useSettings((s) => s.graphics);
  const cfg = GRAPHICS[graphics];
  const [dpr, setDpr] = useState(cfg.dpr);
  useEffect(() => setDpr(cfg.dpr), [cfg]);
  return (
    <Canvas
      key={graphics}
      className="game-canvas"
      shadows={cfg.shadows ? { type: PCFShadowMap } : false}
      dpr={[1, Math.min(dpr, window.devicePixelRatio || 1)]}
      gl={{ antialias: cfg.antialias, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 60, near: 1.2, far: 30000, position: [5200, 60, -400] }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.outputColorSpace = SRGBColorSpace;
      }}
    >
      <World cfg={cfg} />
      {/* keep the simulator responsive: drop resolution before dropping frames */}
      <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(1, d - 0.25))} onIncline={() => setDpr((d) => Math.min(cfg.dpr, d + 0.25))} />
      <AdaptiveDpr />
    </Canvas>
  );
}
