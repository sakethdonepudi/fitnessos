export function fmtNum(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtKg(value, digits = 1) {
  if (value == null) return '—';
  return `${Number(value).toFixed(digits)}`;
}

export function fmtPct(value) {
  if (value == null) return '—';
  return `${Math.round(value)}%`;
}

export function fmtMinutes(value) {
  if (value == null) return '—';
  const mins = Math.round(value);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtDurationClock(minutes) {
  if (minutes == null) return '—';
  const total = Math.round(minutes * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtDate(dateKey, opts = {}) {
  if (!dateKey) return '—';
  const date = new Date(`${dateKey}T12:00:00`);
  const { year, ...rest } = opts;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
    ...rest,
  });
}

export function fmtDateLong(dateKey) {
  if (!dateKey) return '—';
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function fmtWeekday(dateKey) {
  if (!dateKey) return '—';
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}

export function fmtTime(iso, timeZone = 'Asia/Kolkata') {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export function fmtDateTime(iso, timeZone = 'Asia/Kolkata') {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export function relativeTime(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function todayKeyLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(aKey, bKey) {
  const a = new Date(`${aKey}T12:00:00`).getTime();
  const b = new Date(`${bKey}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function signed(value, digits = 1, unit = '') {
  if (value == null) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}${unit}`;
}


/** Offset (minutes east of UTC) for a given instant in a timezone. */
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
  return (asUTC - date.getTime()) / 60000;
}

/** Converts a wall-clock date+time in a specific timezone to a UTC ISO string. */
export function isoForZonedDateTime(dateKey, time, timeZone = 'Asia/Kolkata') {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = String(time || '00:00').split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  let utc = wall;
  for (let i = 0; i < 3; i += 1) {
    utc = wall - tzOffsetMinutes(new Date(utc), timeZone) * 60000;
  }
  return new Date(utc).toISOString();
}

export function timeInZone(iso, timeZone = 'Asia/Kolkata') {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function dateKeyInZone(date, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
