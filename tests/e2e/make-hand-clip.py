#!/usr/bin/env python3
"""
Builds the fake-webcam clip used by tests/e2e/hand-flight.mjs.

The clip is made from REAL hand photographs (MediaPipe's public test images),
moved, rotated and swapped over time, so that Chromium's fake capture device
feeds genuine hand imagery through the real MediaPipe model and the real
SingleHandFlightController. Nothing in the game is mocked.

usage: make-hand-clip.py <work-dir>        (needs ffmpeg and network access)
"""
import os, subprocess, sys, urllib.request

work = sys.argv[1] if len(sys.argv) > 1 else '/tmp/skybound-hands'
os.makedirs(work, exist_ok=True)
os.chdir(work)
BASE = 'https://storage.googleapis.com/mediapipe-assets/'
WALL = '0xb9b4ae'
FPS = 30

def sh(*args):
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', *args])

for name in ['left_hands.jpg', 'fist.jpg', 'thumb_up.jpg', 'victory.jpg']:
    if not os.path.exists(name):
        urllib.request.urlretrieve(BASE + name, name)

# Every photo becomes a 640x480 "camera frame". The open hand is mirrored so all
# four photos show the same hand; the others are shifted (and the fist rotated)
# so their palm centre and wrist angle coincide with the open hand's. The
# offsets were measured by running each photo through the hand tracker.
sh('-i', 'left_hands.jpg', '-vf', 'crop=340:382:0:0,scale=-2:400,setsar=1,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=white,hflip', 'open.png')
def framed(src, dst, dx, dy, rot=0.0):
    vf = f'scale=-2:480,setsar=1,pad=640:480:(ow-iw)/2:0:color={WALL},rotate=a={rot}:c={WALL}:ow=iw:oh=ih,pad=1040:880:200:200:color={WALL},crop=640:480:{200 - dx}:{200 - dy}'
    sh('-i', src, '-vf', vf, dst)
framed('fist.jpg', 'fist.png', 43, 100, -0.265)
framed('thumb_up.jpg', 'thumb.png', 40, 7)
framed('victory.jpg', 'victory.png', 39, 30)
sh('-f', 'lavfi', '-i', f'color=c={WALL}:s=640x480', '-frames:v', '1', 'blank.png')

def piecewise(keys, idx):
    expr = str(keys[-1][idx])
    for i in range(len(keys) - 2, -1, -1):
        t0, t1 = keys[i][0], keys[i + 1][0]
        v0, v1 = keys[i][idx], keys[i + 1][idx]
        expr = f"if(lt(t\\,{t1})\\,({v0}+({v1}-({v0}))*(t-{t0})/({t1}-{t0}))\\,{expr})"
    return expr

segments = []
def moving(src, keys, bg):
    """keys: (t, dx, dy, rot) — displacement in raw-frame pixels (+x = image right, +y = down), rot in radians."""
    out = f'seg{len(segments):02d}.mkv'
    dx, dy, rot = piecewise(keys, 1), piecewise(keys, 2), piecewise(keys, 3)
    vf = f"pad=1280:960:320:240:color={bg},rotate=a='{rot}':c={bg}:ow=iw:oh=ih,crop=640:480:x='320-({dx})':y='240-({dy})',fps={FPS},format=yuvj420p"
    sh('-loop', '1', '-t', str(keys[-1][0]), '-i', src, '-vf', vf, '-c:v', 'mjpeg', '-q:v', '4', out)
    segments.append(out)
def still(src, seconds, dx=0, dy=0, bg=WALL):
    moving(src, [(0, dx, dy, 0), (seconds, dx, dy, 0)], bg)

# ---- phase A: calibration choreography, 36 s, repeated four times (0 – 144 s)
CAL = [(0,0,0,0),(5,0,0,0),(6,-110,0,0),(7.5,-110,0,0),(9.5,110,0,0),(11,110,0,0),(12,0,0,0),(15,0,0,0),
       (16,0,-80,0),(17.5,0,-80,0),(19.5,0,80,0),(21,0,80,0),(22,0,0,0),(25,0,0,0),
       (26,0,0,0.5),(27.5,0,0,0.5),(29.5,0,0,-0.5),(31,0,0,-0.5),(32,0,0,0),(33,0,0,0)]
for _ in range(4):
    moving('open.png', CAL, 'white')
    still('fist.png', 3)
# ---- phase B: a flight, starting at 144 s
still('open.png', 6, bg='white')            # 144  open hand: idle, brakes held
still('fist.png', 70, 0, -30)               # 150  fist, held slightly high: full power, gentle back pressure
still('fist.png', 3, -60, -30)              # 220  ...moved to the player's right: bank right
still('fist.png', 17, 0, -30)               # 223  back to centre
still('thumb.png', 3)                       # 240  thumbs up: autopilot
still('open.png', 6, bg='white')            # 243
still('victory.png', 3)                     # 249  victory: flaps
still('open.png', 4, bg='white')            # 252
still('blank.png', 5)                       # 256  hand leaves the picture: tracking lost
still('open.png', 19, bg='white')           # 261
still('fist.png', 6)                        # 280  tight fist held: emergency pause
still('open.png', 6, bg='white')            # 286
still('fist.png', 6)                        # 292  tight fist held again: resume
still('open.png', 12, bg='white')           # 298 – 310

with open('list.txt', 'w') as f:
    for s in segments:
        f.write(f"file '{s}'\n")
sh('-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-f', 'mjpeg', 'mission.mjpeg')
print(os.path.join(work, 'mission.mjpeg'))
