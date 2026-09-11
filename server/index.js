const path = require('path');
const express = require('express');
const { getActiveAlerts } = require('./sources/nws');
const { getHailReports } = require('./sources/spc');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/hail', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radius = parseFloat(req.query.radius) || 50;

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon query params are required' });
  }

  const [warningsResult, reportsResult] = await Promise.allSettled([
    getActiveAlerts(lat, lon),
    getHailReports(lat, lon, radius),
  ]);

  res.json({
    generatedAt: new Date().toISOString(),
    warnings: warningsResult.status === 'fulfilled' ? warningsResult.value : [],
    warningsError: warningsResult.status === 'rejected' ? warningsResult.reason.message : null,
    reports: reportsResult.status === 'fulfilled' ? reportsResult.value : [],
    reportsError: reportsResult.status === 'rejected' ? reportsResult.reason.message : null,
  });
});

// Small proxy so the client can turn a US ZIP into coordinates without
// hitting third-party APIs directly / worrying about CORS.
app.get('/api/geocode', async (req, res) => {
  const zip = (req.query.zip || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'zip must be a 5-digit US ZIP code' });
  }
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) return res.status(404).json({ error: 'ZIP code not found' });
    const data = await r.json();
    const place = data.places?.[0];
    if (!place) return res.status(404).json({ error: 'ZIP code not found' });
    res.json({
      lat: parseFloat(place.latitude),
      lon: parseFloat(place.longitude),
      label: `${place['place name']}, ${place['state abbreviation']}`,
    });
  } catch (err) {
    res.status(502).json({ error: 'geocoding lookup failed' });
  }
});

app.listen(PORT, () => {
  console.log(`hail-watch running at http://localhost:${PORT}`);
});
