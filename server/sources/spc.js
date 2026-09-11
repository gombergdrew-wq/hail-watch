// Storm Prediction Center preliminary local storm reports (spc.noaa.gov).
// These are the closest thing to "ground truth" hail observations: spotter/
// public/ASOS reports of hail actually occurring, as opposed to a forecast
// warning that hail is possible. They are preliminary/unfiltered.
const { haversineMiles } = require('../geo');

const BASE_URL = 'https://www.spc.noaa.gov/climo/reports';
const USER_AGENT = 'hail-watch (contact: gombergdrew@gmail.com)';
const MAX_AGE_HOURS = 24;

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => {
    const [time, size, location, county, state, lat, lon, ...rest] = line.split(',');
    return {
      time,
      size,
      location,
      county,
      state,
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      comments: rest.join(',').trim(),
    };
  });
}

// SPC's "convective day" runs 12Z-12Z, so a report timestamped e.g. "0130"
// in today_hail.csv can actually belong to the previous calendar date (UTC).
// We reconstruct a real timestamp by assuming it's "now" unless that would
// put it more than an hour in the future, in which case it must be from the
// day before.
function reportTimestamp(hhmm, isYesterdayFile) {
  const now = new Date();
  const hh = parseInt(hhmm.slice(0, 2), 10);
  const mm = parseInt(hhmm.slice(2, 4), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm));
  if (isYesterdayFile) {
    date.setUTCDate(date.getUTCDate() - 1);
  } else if (date.getTime() > now.getTime() + 60 * 60 * 1000) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

async function fetchCsv(name) {
  const res = await fetch(`${BASE_URL}/${name}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`SPC ${name} request failed: ${res.status}`);
  return res.text();
}

async function getHailReports(lat, lon, radiusMiles) {
  const [todayText, yesterdayText] = await Promise.all([
    fetchCsv('today_hail.csv'),
    fetchCsv('yesterday_hail.csv'),
  ]);

  const rows = [
    ...parseCsv(todayText).map((r) => ({ ...r, isYesterdayFile: false })),
    ...parseCsv(yesterdayText).map((r) => ({ ...r, isYesterdayFile: true })),
  ];

  const now = Date.now();
  const cutoff = now - MAX_AGE_HOURS * 60 * 60 * 1000;

  const reports = rows
    .map((r) => {
      if (Number.isNaN(r.lat) || Number.isNaN(r.lon)) return null;
      const timestamp = reportTimestamp(r.time, r.isYesterdayFile);
      if (!timestamp) return null;
      const distanceMiles = haversineMiles(lat, lon, r.lat, r.lon);
      const sizeInches = parseInt(r.size, 10) / 100;
      return {
        timestamp: timestamp.toISOString(),
        sizeInches: Number.isNaN(sizeInches) ? null : sizeInches,
        location: r.location,
        county: r.county,
        state: r.state,
        lat: r.lat,
        lon: r.lon,
        distanceMiles: Math.round(distanceMiles * 10) / 10,
        comments: r.comments,
      };
    })
    .filter((r) => r && r.distanceMiles <= radiusMiles && new Date(r.timestamp).getTime() >= cutoff)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return reports;
}

module.exports = { getHailReports };
