# SKYBOUND — One-Hand Air Control

**Your hands. Your aircraft. Your sky.**

SKYBOUND is a browser flight simulator you fly with **one hand** in front of your webcam. MediaPipe tracks 21 points on your hand in real time. Those measurements become continuous pitch, roll, rudder and throttle inputs for a six-degree-of-freedom flight model, so you can fly over AERONA, a large connected world.

Everything runs locally in your browser. The camera picture is never stored or uploaded, and no paid or cloud services are used.

---

## Quick start

Requirements: **Node.js 18+**, a desktop browser with WebGL 2 (current Chrome, Edge or Firefox), and optionally a webcam.

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open **http://localhost:5173**. Browsers only allow camera access on `localhost` or `https://`, so open the page through one of those.

The first `npm run dev` / `npm run build` runs `scripts/setup-assets.mjs`. It copies the MediaPipe WASM runtime out of `node_modules` and makes sure the hand-landmark model is in `public/models/`. If the model is missing, it downloads it once (about 7.5 MB) from Google's public model storage. After that, the game serves every computer-vision file from its own origin.

For a production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

---

## First flight

1. **AIR CONTROL** (highlighted on first launch) → **Enable camera** → allow access.
2. Show **one** open hand, palm towards the screen, 40–60 cm from the camera. The skeleton overlay appears.
3. **Start calibration** (about 30 s): neutral → move left/right → up/down → rotate the wrist → open hand → fist → try the gestures. Or use **Quick setup**, which takes your first steady hand position as neutral.
4. **Save & fly.** Close your hand to add power, keep it centred until about 60 kt, then raise it gently to climb.

Alternatively, run the **60-second Air Control Academy** from the main menu. It teaches each control and finishes with a real take-off.

## One-hand controls

| Hand | Aircraft |
|---|---|
| Move hand **left / right** | Bank left / right (roll) |
| Move hand **up / down** | Nose up / down (pitch) |
| **Rotate the wrist** like a dial | Rudder (yaw); nose-wheel steering on the ground |
| **Open hand → closed hand** | Throttle idle → full, continuously. Advancing it starts the engine. |
| Open hand while on the ground | Wheel brakes held |
| 🤏 **Pinch** thumb + index | Landing gear up / down |
| 👍 **Thumbs up** | Autopilot (holds heading and altitude; your hand nudges the targets) |
| ✌️ **Victory** sign | Next flap setting |
| ✊ **Tight fist, thumb wrapped over the fingers, held 2 s** | Emergency pause / resume |

How the controller behaves:

- **Continuous control.** Every axis is measured from landmark geometry: palm centre, wrist angle and finger curl. Gesture labels are not used for the flight axes.
- **Signal conditioning.** Inputs are relative to your calibrated neutral, then pass through a radial dead zone, One-Euro filtering, adjustable sensitivity and a soft centre.
- **Throttle vs. pause.** Full throttle is reached at about 78 % hand closure, before the hand becomes a tight fist. The pause gesture needs a tight fist *with the thumb wrapped over the fingers* held for 2 s. A countdown ring is shown, so letting go cancels it.
- **Gesture safety.** Gestures need a hold time, must be released before they can fire again, and have a cooldown. While a thumbs-up or victory sign is being formed, the throttle is frozen at its previous value.
- **Hand lost.** If your hand leaves the picture, pitch, roll and rudder fall back to neutral within a fraction of a second, and the throttle holds. An extreme input is never kept. After 1.2 s in the air, a *level-flight assist* holds the aircraft until your hand returns. When tracking picks up again, control blends back in smoothly instead of jumping.
- **One hand only.** Detection uses `numHands: 1`. The controller locks onto the hand you calibrated with; another hand entering the picture is ignored.

The virtual joystick on the HUD shows your raw hand position (ring), the filtered output (dot), the dead zone (orange) and the sensitivity (blue rim arc). Next to it, the throttle meter shows hand closure, including the red pause zone.

## Keyboard fallback

| Key | Action |
|---|---|
| W / S or ↑ / ↓ | Nose down / up |
| A / D or ← / → | Bank left / right |
| Q / E | Rudder |
| Shift / Ctrl (or = / −) | Throttle up / down |
| Space or B | Wheel brakes |
| G · F / R · Z · I | Gear · flaps down / up · autopilot · engine |
| 1 2 3 4 · C | Cockpit · chase · cinematic · instruments · cycle cameras |
| **Esc or P** | **Pause (always works)** |
| H · X | Hand control on/off · re-centre hand at its current position |
| Tab · K · M · Backspace | Weather panel · controls help · mute · restart from spawn |

The keyboard works at the same time as the hand. Keyboard axes add to hand input, so you can take over at any moment.

---

## What's in the game

- **Flight model:** custom 6-DOF rigid body at a fixed 60 Hz timestep, with 4 substeps and interpolated rendering. It computes lift and drag from air density, airspeed, wing area and per-aircraft coefficients. It models a smooth stall with wing drop, induced drag with ground effect, propeller and jet thrust lapse with density, stability and control derivatives with propwash over the tail, landing-gear springs and friction, braking, steering, flaps, retractable gear, fuel burn, engine spool, overspeed and G damage, and crashes. Optional assists: auto-trim, auto engine start, stall protection.
- **Four aircraft**, each with its own mass, inertia, engine, wing and aerodynamic data:
  - AT-1 Kestrel trainer (forgiving)
  - SR-2 Marlin amphibian (lands on water)
  - TT-6 Albatross twin turboprop (heavy)
  - FX-9 Peregrine fighter-style jet (near-sonic)
- **AERONA:** one continuous procedural world of about 54 × 40 km of mainland plus islands, with no level transitions. Regions:
  - **Metropolis:** skyscrapers, highways with traffic, two bridges and Aerona International.
  - **Highlands:** 2 km peaks, Stonegate valley and two mountain airstrips.
  - **Badlands:** terraced mesas, Serpent Canyon and Sunfire Arch.
  - **Greenbelt:** farmland patchwork, the Silverrun river, villages, a regional airport and a grass strip.
  - **Archipelago:** tropical islands, beaches and Coral Cay.
  - **Open Sky:** open ocean, remote islands, a roaming storm cell and the Zephyr Gates ring course.
- **Terrain streaming:** 2 km chunks are generated in Web Workers at 4 levels of detail. Nearby chunks load and distant ones unload. Skirts hide cracks between levels, and the old mesh stays visible until its replacement is ready.
- **Weather:** clear, cloudy, rain, fog and storm, plus day/night and sunrise/sunset. Every setting has a physical effect: wind with a boundary-layer profile, crosswinds, turbulence gusts and gust-induced rotation, density and gravity. Rain, fog and cloud reduce visibility.
- **Experiment Mode:** live sliders for gravity, wind speed and direction, air density, turbulence, weather, time of day, fuel, damage and invulnerability, with reset-to-defaults.
- **Landing:** contact physics on runways, grass and dirt strips, mountain airstrips, flat terrain and water (Marlin only). Each touchdown is graded on speed, sink rate, runway alignment and centreline, stability and bounces, and gear state.
- **Cameras:** cockpit (live canvas instruments: ASI, attitude, altimeter, RPM, turn coordinator, heading, VSI, fuel, flaps, gear, annunciators), chase, cinematic and instrument-focused, with smooth blends between them.
- **Living world:** AI aircraft flying circuits between airports, airport ground vehicles, runway / approach / PAPI lights, highway traffic, wind turbines, beacons and lit city windows at night.
- **Replay:** flights are recorded at 10 Hz and stored in IndexedDB. You can play them back at 0.5–8×, switch replay cameras, show the coloured flight path in 3D, scrub the speed and altitude charts, and star flights to keep them.
- **Sound:** fully synthesised with Web Audio. Engine sound follows RPM and power for each engine type. Also wind, cockpit hum, flap and gear motors, tyre chirp scaled by sink rate, stall horn, rain, thunder, and spatial airport, city and traffic sources. The audio context starts on your first click or key press.
- **Rapier** handles collisions with every building, bridge and landmark, and simulates crash debris as rigid bodies. The flight model is the only thing that moves the aircraft, so the two physics systems never compete.
- **Performance:** instanced buildings, trees, lights and traffic; worker-based terrain and hand tracking; low / medium / high presets; adaptive resolution. Hand inference rate is adjustable (default 24 fps).

## Settings worth knowing

- **Graphics preset:** view distance, shadows, terrain density and clouds.
- **Hand:** flying hand, sensitivity, rudder sensitivity, dead zones, smoothing, soft centre, invert pitch, gestures on/off, fist-pause time (0 disables), auto-brake, lost-hand assist, webcam preview.
- **Vision:** tracking rate, GPU/CPU inference, and running tracking in a Web Worker.

## Troubleshooting

- **"Camera permission was denied."** Allow the camera for this site in the address-bar permissions, then press *Try again*. You can always fly with the keyboard.
- **Jittery or lost tracking.** Add light in front of you (the AIR CONTROL screen warns when the picture is too dark), keep your whole hand in frame, and stay 40–60 cm from the camera. Raise *Smoothing* or the dead zone.
- **The aircraft drifts with your hand "centred".** Press **X** to re-centre at the current hand position, or recalibrate.
- **Low frame rate.** Choose the *Low* preset, lower the tracking rate, or switch the vision processor between GPU and CPU.
- **No 3D at all.** SKYBOUND needs WebGL 2 with hardware acceleration enabled.

---

## Architecture

```
src/
  types.ts                 shared contracts: HandLandmarks, GestureState, GestureCalibration,
                           FlightInput, AircraftState, WeatherState, ReplayFrame, LandingReport
  app/                     App shell, ControlRouter (hand + keyboard → FlightInput), game-flow actions
  components/              React UI: menu, hangar, AIR CONTROL, HUD, joystick, map, replay, history, settings
  game/
    engine/                Simulation (fixed-step loop), LandingEvaluator, R3F GameCanvas
    physics/               FlightModel (6-DOF), Environment contracts, Rapier CollisionWorld
    aircraft/              specs (4 aircraft) and procedural 3D models
    terrain/               noise, heightfield, chunk builder + worker, LOD streamer
    world/                 AERONA layout, structures, buildings, landmarks, roads
    airports/              runways, markings, lights, PAPI, ground vehicles
    weather/               WeatherSystem (physics side) and Atmosphere (visual side)
    cameras/ cockpit/ replay/ ai/
  vision/
    camera/                CameraManager (permissions, errors, brightness)
    handTracking/          MediaPipe HandLandmarker in a Web Worker (main-thread fallback)
    landmarks/             21-point model and feature extraction
    gestures/              GestureRecognizer (dwell, release, cooldown)
    calibration/           calibration model and step-by-step session
    controls/              One-Euro filter, dead zones, expo
    SingleHandFlightController.ts
    VisionService.ts
  stores/ audio/ persistence/ styles/
```

The vision code and the flight engine never import each other. The vision side produces a `FlightInput` and edge-triggered `FlightCommand`s; the engine consumes them. Each rendered frame: input → fixed-step simulation → read-only interpolated `view` → scene, HUD and audio. React never re-renders during flight; the HUD updates the DOM directly.

## Tests

Run the unit tests:

```bash
npm test
```

There are 33 headless tests:

- **Terrain:** level runways, regions.
- **Flight model:** take-off, cruise, turns, roll rates, pitch and yaw response, stall and recovery, landings, hard / belly / crash damage, density, gravity and wind effects, fuel exhaustion, autopilot, amphibious water landings, a ham-fisted full-back-stick take-off.
- **Engine:** a complete traffic pattern on the real terrain with a graded landing and replay; Rapier structure collisions and debris.
- **Hand controller:** features, pitch/roll/yaw/throttle mapping, dead zones, tracking loss, re-acquisition ramp, every gesture, accidental-trigger rejection, wrong-hand rejection, slow-inference robustness, the full calibration session.

Browser tests drive the real app in Chromium with Playwright. Start `npm run dev` first, then run the keyboard flight test:

```bash
node tests/e2e/keyboard-flight.mjs
```

Run the landing and replay test:

```bash
node tests/e2e/landing-replay.mjs
```

Build the fake-webcam clip from real hand photographs (needs ffmpeg):

```bash
python3 tests/e2e/make-hand-clip.py /tmp/skybound-hands
```

Then run the full one-hand flight through the real MediaPipe pipeline:

```bash
node tests/e2e/hand-flight.mjs /tmp/skybound-hands/mission.mjpeg
```

`hand-flight.mjs` feeds Chromium's fake camera with real hand photos (MediaPipe's public test images), moved, rotated and swapped over time. The real MediaPipe model and the real controller then calibrate, take off, bank, use the gestures, lose the hand and pause, all from that footage.

## Privacy

Video frames go from the camera into a `<video>` element, then into a Web Worker running MediaPipe. Only the 21 landmark coordinates come back. Nothing is recorded, stored or transmitted. Calibration and flights are saved in your browser's IndexedDB, and preferences in `localStorage`.
