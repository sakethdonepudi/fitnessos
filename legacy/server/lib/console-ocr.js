import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OCR_BIN = path.join(__dirname, '..', 'bin', 'ocr-vision');

export function ocrAvailable() {
  return fs.existsSync(OCR_BIN);
}

/**
 * Runs macOS Vision OCR and returns raw text lines with layout boxes.
 * Falls back to an empty result (not a fake success) when unavailable.
 */
export async function recogniseText(imagePath) {
  if (!ocrAvailable()) {
    return { ok: false, reason: 'ocr_unavailable', lines: [] };
  }
  try {
    const { stdout } = await execFileAsync(OCR_BIN, [imagePath], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [text, x, y, w, h] = line.split('\t');
        return {
          text: text.trim(),
          x: Number(x) || 0,
          y: Number(y) || 0,
          w: Number(w) || 0,
          h: Number(h) || 0,
        };
      })
      .filter((l) => l.text.length > 0);
    return { ok: true, lines };
  } catch (err) {
    return { ok: false, reason: 'ocr_failed', error: String(err?.message || err), lines: [] };
  }
}

const PATTERNS = {
  speed: [
    /(?:speed|spd|velocity)\D{0,12}(\d{1,2}(?:[.,]\d{1,2})?)/i,
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:km\/?h|kph)/i,
  ],
  incline: [
    /(?:incline|incl|grade|elev(?:ation)?)\D{0,12}(\d{1,2}(?:[.,]\d{1,2})?)\s*%?/i,
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/,
  ],
  duration: [
    /(?:time|elapsed|duration|timer)\D{0,12}(\d{1,3}:\d{2}(?::\d{2})?)/i,
    /\b(\d{1,3}:\d{2})\b/,
  ],
  distance: [
    /(?:distance|dist)\D{0,12}(\d{1,2}(?:[.,]\d{1,3})?)/i,
    /(\d{1,2}(?:[.,]\d{1,3})?)\s*(?:km|mi)\b/i,
  ],
  calories: [/(?:cal(?:ories)?|kcal)\D{0,12}(\d{2,4})/i, /(\d{2,4})\s*(?:kcal|cal)\b/i],
};

function toNumber(raw) {
  if (!raw) return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseDuration(raw) {
  if (!raw) return null;
  const parts = String(raw).split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  return null;
}

function findField(lines, key) {
  for (const pattern of PATTERNS[key]) {
    for (const line of lines) {
      const m = line.text.match(pattern);
      if (m) {
        const value = key === 'duration' ? parseDuration(m[1]) : toNumber(m[1]);
        if (value != null) return { value, raw: m[0].trim(), line: line.text };
      }
    }
  }
  return null;
}

/**
 * Extracts console readings and flags disagreements with the logged session.
 *
 * IMPORTANT: a console photo shows a machine's display. It corroborates
 * numbers. It cannot prove who was on the machine or that the session was
 * completed as claimed.
 */
export function parseConsoleReadings(lines, session) {
  const speed = findField(lines, 'speed');
  const incline = findField(lines, 'incline');
  const duration = findField(lines, 'duration');
  const distance = findField(lines, 'distance');
  const calories = findField(lines, 'calories');

  const extracted = {
    speedKmh: speed?.value ?? null,
    inclinePct: incline?.value ?? null,
    durationMin: duration?.value ?? null,
    distanceKm: distance?.value ?? null,
    activeCalories: calories?.value ?? null,
  };

  const tolerances = {
    speedKmh: 0.4,
    inclinePct: 1.0,
    durationMin: 2.0,
    distanceKm: 0.15,
    activeCalories: 25,
  };

  const fieldLabels = {
    speedKmh: 'Speed',
    inclinePct: 'Incline',
    durationMin: 'Duration',
    distanceKm: 'Distance',
    activeCalories: 'Calories',
  };

  const sessionColumns = {
    speedKmh: 'speed_kmh',
    inclinePct: 'incline_pct',
    durationMin: 'duration_min',
    distanceKm: 'distance_km',
    activeCalories: 'active_calories',
  };

  const comparisons = [];
  if (session) {
    for (const [key, tol] of Object.entries(tolerances)) {
      const extractedValue = extracted[key];
      const loggedValue = session[sessionColumns[key]];
      if (extractedValue == null) continue;
      if (loggedValue == null) {
        comparisons.push({
          field: key,
          label: fieldLabels[key],
          extracted: extractedValue,
          logged: null,
          delta: null,
          status: 'missing_logged',
          message: `${fieldLabels[key]} read from the photo but not in the session log.`,
        });
        continue;
      }
      const delta = Math.round((extractedValue - loggedValue) * 100) / 100;
      const mismatch = Math.abs(delta) > tol;
      comparisons.push({
        field: key,
        label: fieldLabels[key],
        extracted: extractedValue,
        logged: loggedValue,
        delta,
        tolerance: tol,
        status: mismatch ? 'discrepancy' : 'match',
        message: mismatch
          ? `${fieldLabels[key]}: photo shows ${extractedValue}, log says ${loggedValue}.`
          : `${fieldLabels[key]} matches within tolerance.`,
      });
    }
  }

  const foundCount = Object.values(extracted).filter((v) => v != null).length;

  return {
    extracted,
    comparisons,
    foundCount,
    hasDiscrepancy: comparisons.some((c) => c.status === 'discrepancy'),
    disclaimer:
      'A console photo corroborates displayed numbers only. It does not prove who used the machine or that the session was completed as logged.',
    confidence: foundCount >= 4 ? 'high' : foundCount >= 2 ? 'medium' : 'low',
  };
}
