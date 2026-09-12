# Climbing Wall Projector

Light up specific climbing holds on a real wall by projecting onto it. Take a
photo of the wall, mark the holds, pick a route, and project it.

This is a separate app from the rest of this repo — it doesn't touch or share
data with `hail-watch`.

## Running it

```
npm run climbing
```

Serves on `http://localhost:3100` by default (override with `CLIMBING_PORT`).
If your control device (phone) and the machine driving the projector are
different, use the server machine's LAN IP instead of `localhost` from the
phone, e.g. `http://192.168.1.42:3100`.

## Setup workflow

1. **Photo** — open the app, upload/take a straight-on photo of the wall.
2. **Mark holds** — in *Sample* mode, tap a hold; every hold sharing that
   color auto-detects. Tune "color match sensitivity" if it's too aggressive
   or misses holds. Use *Add* to manually drop a marker the detector missed,
   and *Edit* to drag, resize, or delete a marker.
3. **Build a route** — switch to *Route* mode and tap markers to toggle them
   into the active route (shown green).
4. **Project it** — open "Open projector view" on the device connected to the
   projector (HDMI-out laptop, or a cast tab). Full-screen it.
5. **Calibrate once per projector setup** — click *Calibrate* on the
   projector page. Your wall photo appears semi-transparent with 4 draggable
   corner handles. Physically look at the projected image on the wall and
   drag each corner until the projected photo lines up with the real wall,
   then click *Save alignment*. Re-run this any time the projector or wall
   moves.

Once calibrated, toggling holds in *Route* mode on the control page updates
the projector view live (holds appear as a soft glow at their real position
on the wall).

## How it works

- **Hold detection** is color-seeded blob detection (not general-purpose ML
  hold recognition, which isn't practical to build from scratch): you tap a
  sample hold, the app scans the photo for similarly colored regions
  (HSV distance), groups connected pixels into blobs, and turns each
  plausible blob into a marker. Multi-colored walls just need one tap per
  color. Always review/correct results — auto-detection is a starting point,
  not a guarantee.
- **Calibration** uses a 4-point homography (the standard technique for
  aligning a projected image to a physical surface from any projector
  angle/lens). Once the 4 corners are matched, every hold's photo pixel
  coordinate maps precisely onto the wall regardless of projector position.
- **State** (photo, holds, route, calibration) lives in
  `climbing-wall/data/`, as plain files — no database. The projector page
  gets live updates over Server-Sent Events, so it works whether the control
  page and projector page are the same machine or two devices on the same
  network.
