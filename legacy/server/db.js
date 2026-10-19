import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.FITNESS_DATA_DIR
  ? path.resolve(process.env.FITNESS_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');

export const PHOTO_DIR = path.join(DATA_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'fitness.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sex TEXT,
  birth_date TEXT,
  height_cm REAL,
  start_date TEXT NOT NULL,
  checkpoint_date TEXT NOT NULL,
  waist_start_cm REAL,
  activity_level TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  calories INTEGER NOT NULL,
  protein_g INTEGER NOT NULL,
  carbs_g INTEGER,
  fat_g INTEGER,
  water_ml INTEGER NOT NULL DEFAULT 3000,
  step_goal INTEGER NOT NULL DEFAULT 10000,
  treadmill_min_week INTEGER NOT NULL DEFAULT 150,
  target_weight_kg REAL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS weigh_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight_kg REAL,
  body_fat_pct REAL,
  body_fat_source TEXT,
  waist_cm REAL,
  source TEXT NOT NULL DEFAULT 'self_reported',
  photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  name TEXT NOT NULL,
  calories REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user_logged',
  photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meals(user_id, date);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  servings REAL NOT NULL DEFAULT 1,
  instructions TEXT,
  calories REAL NOT NULL DEFAULT 0,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'g',
  calories REAL NOT NULL DEFAULT 0,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS water_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ml INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'self_reported',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_water_user_date ON water_logs(user_id, date);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  split TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  source TEXT NOT NULL DEFAULT 'user_logged',
  health_workout_id TEXT,
  duration_min REAL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workout_user_date ON workout_sessions(user_id, date);

CREATE TABLE IF NOT EXISTS exercise_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL,
  set_index INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight_kg REAL NOT NULL,
  rpe REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treadmill_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  blocks_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treadmill_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  preset_id INTEGER REFERENCES treadmill_presets(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Incline Fat-Loss Walk',
  planned_start TEXT,
  start_time TEXT,
  end_time TEXT,
  duration_min REAL,
  speed_kmh REAL,
  incline_pct REAL,
  distance_km REAL,
  avg_hr REAL,
  max_hr REAL,
  active_calories REAL,
  calories_source TEXT,
  difficulty TEXT,
  recovery_status TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  health_workout_id TEXT,
  console_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  console_extracted_json TEXT,
  console_confirmed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'logged',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_treadmill_user_date ON treadmill_sessions(user_id, date);

CREATE TABLE IF NOT EXISTS health_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  step_samples_count INTEGER NOT NULL DEFAULT 0,
  workouts_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS health_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS health_step_samples (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  steps INTEGER NOT NULL,
  source TEXT NOT NULL,
  device TEXT,
  imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_samples_user_time ON health_step_samples(user_id, start_time);

CREATE TABLE IF NOT EXISTS health_workouts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_sec REAL,
  distance_km REAL,
  avg_hr REAL,
  max_hr REAL,
  active_calories REAL,
  source TEXT NOT NULL,
  device TEXT,
  imported_at TEXT NOT NULL,
  linked_treadmill_id INTEGER REFERENCES treadmill_sessions(id) ON DELETE SET NULL,
  linked_workout_id INTEGER REFERENCES workout_sessions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS steps_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  total_steps INTEGER NOT NULL DEFAULT 0,
  treadmill_steps INTEGER NOT NULL DEFAULT 0,
  qualifying_steps INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'unknown',
  uncertainty_pct REAL NOT NULL DEFAULT 0,
  sample_resolution_sec INTEGER,
  sources_json TEXT,
  synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending_sync',
  PRIMARY KEY(user_id, date)
);

CREATE TABLE IF NOT EXISTS recovery_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sleep_hours REAL,
  resting_hr REAL,
  soreness INTEGER,
  readiness INTEGER,
  stress INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'self_reported',
  created_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  taken_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  angle TEXT NOT NULL,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, week_start, angle)
);

CREATE TABLE IF NOT EXISTS daily_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  reconciled_json TEXT,
  status TEXT NOT NULL DEFAULT 'final',
  created_at TEXT NOT NULL,
  reconciled_at TEXT,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, at DESC);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  run_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  UNIQUE(name, run_date)
);
`);

export function nowIso() {
  return new Date().toISOString();
}

// Lightweight forward-only migrations for databases created by earlier builds.
const healthWorkoutCols = db.prepare(`PRAGMA table_info(health_workouts)`).all().map((c) => c.name);
if (!healthWorkoutCols.includes('linked_workout_id')) {
  db.exec(`ALTER TABLE health_workouts ADD COLUMN linked_workout_id INTEGER REFERENCES workout_sessions(id)`);
}

export function audit(userId, entity, entityId, action, before, after) {
  db.prepare(
    `INSERT INTO audit_log (user_id, entity, entity_id, action, before_json, after_json, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    entity,
    entityId == null ? null : String(entityId),
    action,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    nowIso()
  );
}
