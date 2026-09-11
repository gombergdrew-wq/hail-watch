const STORAGE_KEY = 'hail-watch-locations';
const REFRESH_MS = 5 * 60 * 1000;

const locationsEl = document.getElementById('locations');
const emptyStateEl = document.getElementById('empty-state');
const cardTemplate = document.getElementById('location-card-template');
const addLocationError = document.getElementById('add-location-error');

/** @type {Map<string, { map: L.Map, marker: L.Marker, circle: L.Circle, reportMarkers: L.Marker[] }>} */
const mapInstances = new Map();

function loadLocations() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLocations(locations) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(locations));
}

function showAddError(message) {
  addLocationError.textContent = message;
  addLocationError.hidden = !message;
}

function addLocation(label, lat, lon) {
  const locations = loadLocations();
  locations.push({ id: crypto.randomUUID(), label, lat, lon, radius: 50 });
  saveLocations(locations);
  renderAll();
}

function removeLocation(id) {
  const instance = mapInstances.get(id);
  if (instance) {
    instance.map.remove();
    mapInstances.delete(id);
  }
  const locations = loadLocations().filter((l) => l.id !== id);
  saveLocations(locations);
  renderAll();
}

function updateLocationRadius(id, radius) {
  const locations = loadLocations();
  const loc = locations.find((l) => l.id === id);
  if (loc) {
    loc.radius = radius;
    saveLocations(locations);
    refreshCard(loc);
  }
}

function formatTimeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hr ago`;
}

function renderAll() {
  const locations = loadLocations();
  emptyStateEl.hidden = locations.length > 0;
  locationsEl.innerHTML = '';
  mapInstances.forEach((instance) => instance.map.remove());
  mapInstances.clear();

  locations.forEach((loc) => {
    const node = cardTemplate.content.cloneNode(true);
    const card = node.querySelector('.location-card');
    card.dataset.id = loc.id;
    card.querySelector('.location-label').textContent = loc.label;
    card.querySelector('.location-coords').textContent = `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`;
    card.querySelector('.radius-select').value = String(loc.radius);

    card.querySelector('.remove-btn').addEventListener('click', () => removeLocation(loc.id));
    card.querySelector('.refresh-btn').addEventListener('click', () => refreshCard(loc));
    card.querySelector('.radius-select').addEventListener('change', (e) => {
      updateLocationRadius(loc.id, parseInt(e.target.value, 10));
    });

    locationsEl.appendChild(node);

    const mapEl = locationsEl.querySelector(`.location-card[data-id="${loc.id}"] .map`);
    const map = L.map(mapEl, { attributionControl: false }).setView([loc.lat, loc.lon], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12 }).addTo(map);
    const marker = L.marker([loc.lat, loc.lon]).addTo(map).bindPopup(loc.label);
    const circle = L.circle([loc.lat, loc.lon], {
      radius: loc.radius * 1609.34,
      color: '#4fa3e3',
      fillOpacity: 0.05,
    }).addTo(map);
    mapInstances.set(loc.id, { map, marker, circle, reportMarkers: [] });

    refreshCard(loc);
  });
}

async function refreshCard(loc) {
  const card = locationsEl.querySelector(`.location-card[data-id="${loc.id}"]`);
  if (!card) return;
  const statusEl = card.querySelector('.status-line');
  const warningsEl = card.querySelector('.warnings-list');
  const reportsEl = card.querySelector('.reports-list');
  const noReportsEl = card.querySelector('.no-reports');

  statusEl.textContent = 'Checking for hail…';

  try {
    const res = await fetch(`/api/hail?lat=${loc.lat}&lon=${loc.lon}&radius=${loc.radius}`);
    const data = await res.json();

    statusEl.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;

    warningsEl.innerHTML = '';
    if (data.warnings.length === 0) {
      const none = document.createElement('div');
      none.className = 'status-line';
      none.textContent = 'No active severe thunderstorm / hail-related warnings.';
      warningsEl.appendChild(none);
    } else {
      data.warnings.forEach((w) => {
        const div = document.createElement('div');
        div.className = 'warning-item';
        const sizeText = w.hailSizeInches ? ` — up to ${w.hailSizeInches}" hail` : '';
        div.innerHTML = `<div class="event">${w.event}${sizeText}</div><div class="headline">${w.headline || ''}</div>`;
        warningsEl.appendChild(div);
      });
    }

    reportsEl.innerHTML = '';
    noReportsEl.hidden = data.reports.length > 0;
    data.reports.forEach((r) => {
      const li = document.createElement('li');
      const sizeText = r.sizeInches ? `<span class="report-size">${r.sizeInches.toFixed(2)}"</span>` : 'size unknown';
      li.innerHTML = `${sizeText} hail near ${r.location}, ${r.state} — ${r.distanceMiles} mi away, ${formatTimeAgo(r.timestamp)}`;
      reportsEl.appendChild(li);
    });

    const instance = mapInstances.get(loc.id);
    if (instance) {
      instance.reportMarkers.forEach((m) => instance.map.removeLayer(m));
      instance.reportMarkers = data.reports
        .filter((r) => typeof r.lat === 'number')
        .map((r) => L.circleMarker([r.lat, r.lon], { radius: 6, color: '#e35d5d' }).addTo(instance.map));
    }

    if (data.warningsError || data.reportsError) {
      statusEl.textContent += ' (some data unavailable — retrying next refresh)';
    }
  } catch (err) {
    statusEl.textContent = 'Unable to fetch hail data right now.';
  }
}

document.getElementById('use-my-location').addEventListener('click', () => {
  showAddError('');
  if (!navigator.geolocation) {
    showAddError('Geolocation is not supported in this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      addLocation('My location', pos.coords.latitude, pos.coords.longitude);
    },
    () => showAddError('Could not get your location. Try a ZIP code instead.'),
    { timeout: 10000 }
  );
});

document.getElementById('zip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showAddError('');
  const zip = document.getElementById('zip-input').value.trim();
  try {
    const res = await fetch(`/api/geocode?zip=${zip}`);
    const data = await res.json();
    if (!res.ok) {
      showAddError(data.error || 'Could not find that ZIP code.');
      return;
    }
    addLocation(data.label, data.lat, data.lon);
    document.getElementById('zip-input').value = '';
  } catch {
    showAddError('Lookup failed. Try again.');
  }
});

renderAll();
setInterval(() => loadLocations().forEach(refreshCard), REFRESH_MS);
