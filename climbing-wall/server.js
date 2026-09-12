const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.CLIMBING_PORT || 3100;

const dataDir = path.join(__dirname, 'data');
const stateFile = path.join(dataDir, 'state.json');
const photoFile = path.join(dataDir, 'wall.jpg');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const defaultState = { photo: null, holds: [], active: [], calibration: null };

function loadState() {
  try {
    return { ...defaultState, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
  } catch {
    return { ...defaultState };
  }
}

let state = loadState();
let sseClients = [];

function saveState() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function broadcast() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (req, res) => {
  res.json(state);
});

app.get('/api/state/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(state)}\n\n`);
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

app.get('/photo.jpg', (req, res) => {
  if (!fs.existsSync(photoFile)) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  res.sendFile(photoFile);
});

// Body: { dataUrl: "data:image/jpeg;base64,...", width, height }
// Replacing the photo invalidates any previously marked holds/route/calibration,
// since their coordinates were measured against the old image.
app.post('/api/photo', (req, res) => {
  const { dataUrl, width, height } = req.body || {};
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl || '');
  if (!match || !Number.isFinite(width) || !Number.isFinite(height)) {
    return res.status(400).json({ error: 'expected { dataUrl: data:image/jpeg;base64,..., width, height }' });
  }
  fs.writeFileSync(photoFile, Buffer.from(match[1], 'base64'));
  state = { photo: { width, height }, holds: [], active: [], calibration: null };
  saveState();
  broadcast();
  res.json(state);
});

// Body: { holds: [{ id, x, y, r, color }, ...] }
app.post('/api/holds', (req, res) => {
  const { holds } = req.body || {};
  if (!Array.isArray(holds)) return res.status(400).json({ error: 'holds must be an array' });
  state.holds = holds;
  state.active = state.active.filter((id) => holds.some((h) => h.id === id));
  saveState();
  broadcast();
  res.json(state);
});

// Body: { active: [id, ...] }
app.post('/api/active', (req, res) => {
  const { active } = req.body || {};
  if (!Array.isArray(active)) return res.status(400).json({ error: 'active must be an array of hold ids' });
  state.active = active;
  saveState();
  broadcast();
  res.json(state);
});

// Body: { corners: [[x,y],[x,y],[x,y],[x,y]] } in projector-canvas space,
// ordered top-left, top-right, bottom-right, bottom-left to match the photo rect.
app.post('/api/calibration', (req, res) => {
  const { corners } = req.body || {};
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some((p) => !Array.isArray(p) || p.length !== 2)) {
    return res.status(400).json({ error: 'corners must be an array of 4 [x, y] points' });
  }
  state.calibration = { corners };
  saveState();
  broadcast();
  res.json(state);
});

app.listen(PORT, () => {
  console.log(`climbing-wall running at http://localhost:${PORT}`);
});
