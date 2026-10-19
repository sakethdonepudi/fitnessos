function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function appleDate(value) {
  if (!value) return null;
  // "2026-10-19 07:00:00 +0530" -> ISO with colon offset
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2})(\d{2})$/);
  if (match) return new Date(`${match[1]}T${match[2]}${match[3]}:${match[4]}`).toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeWorkoutType(value) {
  const v = String(value || '').replace('HKWorkoutActivityType', '');
  const map = {
    Walking: 'walking',
    Running: 'running',
    Cycling: 'cycling',
    TraditionalStrengthTraining: 'traditional_strength_training',
    FunctionalStrengthTraining: 'functional_strength_training',
    HighIntensityIntervalTraining: 'hiit',
    Yoga: 'yoga',
    Elliptical: 'elliptical',
    Rowing: 'rowing',
  };
  return map[v] || v.toLowerCase() || 'other';
}

export async function parseHealthFile(file) {
  const name = file.name || '';
  const size = file.size || 0;
  if (size > 120 * 1024 * 1024) {
    throw new Error('This file is larger than 120 MB. Export a shorter date range from the companion, or use the JSON snapshot.');
  }
  const text = await file.text();
  const trimmed = text.trim();

  if (name.toLowerCase().endsWith('.json') || trimmed.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('The JSON file could not be parsed.');
    }
    const samples = Array.isArray(data.samples) ? data.samples : Array.isArray(data.stepSamples) ? data.stepSamples : [];
    const workouts = Array.isArray(data.workouts) ? data.workouts : [];
    if (!samples.length && !workouts.length) {
      throw new Error('No step samples or workouts were found in this JSON file.');
    }
    return {
      payload: {
        version: data.version || 1,
        source: data.source || 'iPhone companion',
        syncedAt: data.syncedAt || new Date().toISOString(),
        samples: samples.map((s) => ({
          id: String(s.id || `json-${fnv(`${s.start || s.start_time}|${s.end || s.end_time}|${s.steps}`)}`),
          start: s.start || s.start_time,
          end: s.end || s.end_time,
          steps: Number(s.steps),
          source: s.source || data.source || 'Apple Health',
          device: s.device || null,
        })),
        workouts: workouts.map((w) => ({
          id: String(w.id || `json-w-${fnv(`${w.start || w.start_time}|${w.type}`)}`),
          type: w.type || 'other',
          start: w.start || w.start_time,
          end: w.end || w.end_time,
          durationSec: w.durationSec ?? w.duration_sec,
          distanceKm: w.distanceKm ?? w.distance_km,
          avgHr: w.avgHr ?? w.avg_hr,
          maxHr: w.maxHr ?? w.max_hr,
          activeCalories: w.activeCalories ?? w.active_calories,
          source: w.source || data.source || 'Apple Health',
          device: w.device || null,
        })),
        deletedSampleIds: data.deletedSampleIds || [],
        deletedWorkoutIds: data.deletedWorkoutIds || [],
      },
      format: 'companion-json',
      warnings: [],
    };
  }

  if (name.toLowerCase().endsWith('.xml') || trimmed.startsWith('<')) {
    const records = [...trimmed.matchAll(/<Record\b([^>]*)\/>/g)];
    const sampleMap = new Map();
    const warnings = [];
    for (const [, attrs] of records) {
      if (!/HKQuantityTypeIdentifierStepCount/.test(attrs)) continue;
      const attr = (key) => {
        const m = attrs.match(new RegExp(`${key}="([^"]*)"`));
        return m ? m[1] : null;
      };
      const start = appleDate(attr('startDate'));
      const end = appleDate(attr('endDate'));
      const value = Number(attr('value'));
      const source = attr('sourceName') || 'Apple Health';
      if (!start || !end || !Number.isFinite(value) || value < 0) continue;
      const id = `ah-${fnv(`${start}|${end}|${source}|${value}`)}`;
      sampleMap.set(id, {
        id,
        start,
        end,
        steps: Math.round(value),
        source,
        device: attr('device') || null,
      });
    }

    const workouts = [];
    const workoutMatches = [...trimmed.matchAll(/<Workout\b([^>]*)>([\s\S]*?)<\/Workout>/g)];
    for (const [, attrs, inner] of workoutMatches) {
      const attr = (key) => {
        const m = attrs.match(new RegExp(`${key}="([^"]*)"`));
        return m ? m[1] : null;
      };
      const start = appleDate(attr('startDate'));
      const end = appleDate(attr('endDate'));
      if (!start || !end) continue;
      const type = normalizeWorkoutType(attr('workoutActivityType'));
      const distance = Number(attr('totalDistance'));
      const energy = Number(attr('totalEnergyBurned'));
      const hrMatch = inner.match(/<WorkoutStatistics[^>]*type="HKQuantityTypeIdentifierHeartRate"[^>]*average="([^"]*)"[^>]*maximum="([^"]*)"/);
      workouts.push({
        id: `ah-w-${fnv(`${start}|${end}|${type}`)}`,
        type,
        start,
        end,
        durationSec: Number(attr('duration')) || Math.round((new Date(end) - new Date(start)) / 1000),
        distanceKm: Number.isFinite(distance) ? distance : null,
        activeCalories: Number.isFinite(energy) ? energy : null,
        avgHr: hrMatch ? Number(hrMatch[1]) : null,
        maxHr: hrMatch ? Number(hrMatch[2]) : null,
        source: attr('sourceName') || 'Apple Health',
        device: attr('device') || null,
      });
    }

    if (!sampleMap.size && !workouts.length) {
      throw new Error('No step records or workouts were found in this Apple Health export.');
    }
    return {
      payload: {
        version: 1,
        source: 'Apple Health export.xml',
        syncedAt: new Date().toISOString(),
        samples: [...sampleMap.values()],
        workouts,
        deletedSampleIds: [],
        deletedWorkoutIds: [],
      },
      format: 'apple-health-xml',
      warnings,
    };
  }

  throw new Error('Unsupported file. Choose the companion JSON snapshot or an Apple Health export.xml file.');
}

export function summarizeImport(result) {
  return {
    format: result.format,
    samples: result.payload.samples.length,
    workouts: result.payload.workouts.length,
    warnings: result.warnings.length,
  };
}
