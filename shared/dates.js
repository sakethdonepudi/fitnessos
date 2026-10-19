const MS_MIN = 60_000;

export function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUTC - date.getTime()) / MS_MIN;
}

export function localDateKey(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(date);
}

export function localDayBounds(dateKey, timeZone) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = wall;
  for (let i = 0; i < 3; i += 1) {
    const offset = tzOffsetMinutes(new Date(utc), timeZone);
    utc = wall - offset * MS_MIN;
  }
  const start = new Date(utc);
  const nextWall = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  let nextUtc = nextWall;
  for (let i = 0; i < 3; i += 1) {
    const offset = tzOffsetMinutes(new Date(nextUtc), timeZone);
    nextUtc = nextWall - offset * MS_MIN;
  }
  return { start, end: new Date(nextUtc) };
}

export function todayKey(timeZone) {
  return localDateKey(new Date(), timeZone);
}

export function addDaysKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(aKey, bKey) {
  const [ay, am, ad] = aKey.split('-').map(Number);
  const [by, bm, bd] = bKey.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function eachDate(startKey, endKey) {
  const out = [];
  let cur = startKey;
  let guard = 0;
  while (cur <= endKey && guard < 800) {
    out.push(cur);
    cur = addDaysKey(cur, 1);
    guard += 1;
  }
  return out;
}

export function weekStartKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 Sun
  const diff = dow === 0 ? -6 : 1 - dow; // Monday
  return addDaysKey(dateKey, diff);
}

export function formatTimeInZone(iso, timeZone) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function formatDateTimeInZone(iso, timeZone) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'short',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function minutesBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  return (new Date(endIso) - new Date(startIso)) / MS_MIN;
}

export function isStale(iso, hours) {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > hours * 3_600_000;
}
