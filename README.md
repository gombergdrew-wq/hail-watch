# Hail Watch

A small web app for tracking hail near the places you care about. Anyone who
opens it can save one or more locations (their current location or a US ZIP
code) and see:

- **Active warnings** — live [National Weather Service](https://www.weather.gov/)
  Severe Thunderstorm Warnings / Watches, Tornado Warnings, and Special Weather
  Statements for that point, including hail size when NWS provides it.
- **Recent hail reports** — the last 24 hours of preliminary local storm
  reports from the [Storm Prediction Center](https://www.spc.noaa.gov/climo/reports/),
  which are ground-truth observations (spotters, public, ASOS) rather than
  forecasts, filtered to a radius around the saved location.

Saved locations live only in your browser (`localStorage`) — there's no
account system and no server-side database.

## Why these data sources

NWS alerts and SPC storm reports are both free, public-domain, and
authoritative: NWS is the official source for active warnings, and SPC storm
reports are the standard reference dataset for "did hail actually happen
here." SPC reports are explicitly preliminary/not quality-controlled, which
the app surfaces in the footer.

A natural future upgrade is NOAA's MRMS MESH (radar-estimated hail size)
product for near-real-time coverage between storm reports, and NWS impact-based
warning "tags" for max hail size trends.

## Running locally

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

## Project layout

- `server/index.js` — Express app: serves the static frontend and two API
  routes (`/api/hail`, `/api/geocode`).
- `server/sources/nws.js` — NWS active alerts client.
- `server/sources/spc.js` — SPC storm report CSV fetch/parse/filter.
- `public/` — plain HTML/CSS/JS frontend (Leaflet for the map).

## Roadmap

- [ ] Push/email notifications when a new warning or report appears near a
      saved location (the current version is read/refresh-only).
- [ ] Persist saved locations server-side (with accounts) instead of
      per-browser localStorage, so alerts can be delivered even when the tab
      isn't open.
- [ ] MRMS MESH radar hail swaths as a map layer.
- [ ] Deploy (Render/Fly.io/Railway all support long-running Node servers on
      a free/cheap tier).
