// National Weather Service active alerts (api.weather.gov).
// NWS requires a descriptive User-Agent identifying the app + contact.
const USER_AGENT = 'hail-watch (https://github.com/, contact: gombergdrew@gmail.com)';

const HAIL_RELEVANT_EVENTS = new Set([
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Tornado Warning',
  'Special Weather Statement',
]);

function extractHailSize(properties) {
  const params = properties.parameters || {};
  const raw = params.maxHailSize?.[0];
  if (raw) {
    const size = parseFloat(raw);
    if (!Number.isNaN(size)) return size;
  }
  // Fallback: parse free-text description, e.g. "HAIL...1.75 IN"
  const match = /HAIL[.\s]*\.*\s*([0-9]+(?:\.[0-9]+)?)\s*IN/i.exec(properties.description || '');
  if (match) return parseFloat(match[1]);
  return null;
}

async function getActiveAlerts(lat, lon) {
  const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
  });
  if (!res.ok) {
    throw new Error(`NWS alerts request failed: ${res.status}`);
  }
  const data = await res.json();
  const features = data.features || [];

  return features
    .filter((f) => HAIL_RELEVANT_EVENTS.has(f.properties.event))
    .map((f) => {
      const p = f.properties;
      return {
        id: p.id,
        event: p.event,
        severity: p.severity,
        headline: p.headline,
        description: p.description,
        instruction: p.instruction,
        onset: p.onset,
        ends: p.ends,
        expires: p.expires,
        senderName: p.senderName,
        hailSizeInches: extractHailSize(p),
      };
    });
}

module.exports = { getActiveAlerts };
