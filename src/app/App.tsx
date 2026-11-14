import { Component, useEffect, useState, type ReactNode } from 'react';
import { audio } from '../audio/AudioEngine';
import { Academy } from '../components/Academy';
import { AirControl } from '../components/AirControl';
import { EnvironmentPanel } from '../components/EnvironmentPanel';
import { CrashCard, FlightToolbar, HelpOverlay, LandingCard, LoadingOverlay, PauseMenu, Toasts } from '../components/FlightOverlays';
import { FlightHistory } from '../components/FlightHistory';
import { Hangar } from '../components/Hangar';
import { Hud } from '../components/Hud';
import { MainMenu } from '../components/MainMenu';
import { ReplayUI } from '../components/ReplayUI';
import { SettingsScreen } from '../components/SettingsScreen';
import { WorldMap } from '../components/WorldMap';
import { GameCanvas, perf, worldRef } from '../game/engine/GameCanvas';
import { sim } from '../game/engine/Simulation';
import { useApp } from '../stores/appStore';
import { useSettings } from '../stores/settingsStore';
import { vision } from '../vision/VisionService';
import { exitToMenu, startFlight, wireApp } from './actions';
import { controls } from './ControlRouter';

function webglProblem(): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'This browser or device does not provide WebGL 2, which SKYBOUND needs for its 3D world.';
    return null;
  } catch {
    return 'WebGL could not be initialised.';
  }
}

class Boundary extends Component<{ children: ReactNode; label: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message || String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <h2>{this.props.label}</h2>
          <p>{this.state.error}</p>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
            RELOAD
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const screen = useApp((s) => s.screen);
  const paused = useApp((s) => s.paused);
  const [glError] = useState(webglProblem);

  useEffect(() => {
    wireApp();
    controls.attach();
    const s = useApp.getState();
    sim.preview(s.aircraftId, s.spawnId);
    void vision.loadCalibration();
    // debugging / automated-test handle
    (window as unknown as Record<string, unknown>).__skybound = { sim, controls, app: useApp, settings: useSettings, vision, perf, world: worldRef, audio, startFlight, exitToMenu };
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      controls.detach();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // sound only while actually flying or replaying
  useEffect(() => {
    audio.setSuspended(!((screen === 'flight' && !paused) || screen === 'replay'));
  }, [screen, paused]);

  if (glError) {
    return (
      <div className="fatal">
        <h1>SKYBOUND</h1>
        <h2>3D graphics are not available</h2>
        <p>{glError}</p>
        <p className="dim">Try a current version of Chrome, Edge or Firefox on a desktop computer, and make sure hardware acceleration is enabled.</p>
      </div>
    );
  }

  const flight = screen === 'flight';
  return (
    <>
      <Boundary label="The 3D world stopped unexpectedly">
        <GameCanvas />
      </Boundary>
      <Boundary label="The interface stopped unexpectedly">
        {screen === 'menu' && <MainMenu />}
        {screen === 'hangar' && <Hangar />}
        {screen === 'aircontrol' && <AirControl />}
        {screen === 'map' && <WorldMap />}
        {screen === 'history' && <FlightHistory />}
        {screen === 'settings' && <SettingsScreen />}
        {flight && (
          <>
            <Hud />
            <FlightToolbar />
            <EnvironmentPanel />
            <Academy />
            <LandingCard />
            <CrashCard />
            <PauseMenu />
            <HelpOverlay />
          </>
        )}
        {screen === 'replay' && (
          <>
            <Hud replay />
            <ReplayUI />
          </>
        )}
        <LoadingOverlay />
        <Toasts />
      </Boundary>
    </>
  );
}
