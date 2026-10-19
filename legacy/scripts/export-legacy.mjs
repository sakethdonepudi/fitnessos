/**
 * Exports the legacy SQLite database (including photo blobs) to a single JSON
 * file that the static app or the Node migration script can import.
 *
 * Usage:
 *   DB_PATH=./data/fitness.db node legacy/scripts/export-legacy.mjs
 *   # writes migration/legacy-export.json + migration/export-manifest.json
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'fitness.db');
const photoDir = process.env.PHOTO_DIR || path.join(root, 'data', 'photos');
const outDir = path.join(root, 'migration');
fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const all = (sql) => db.prepare(sql).all();
const user = all(`SELECT * FROM users ORDER BY id LIMIT 1`)[0];
if (!user) {
  console.error('No user row found in the legacy database.');
  process.exit(1);
}
const uid = user.id;

const exportData = {
  exportedAt: new Date().toISOString(),
  source: { database: dbPath, userId: uid, email: user.email },
  user: { id: user.id, email: user.email, name: user.name, timezone: user.timezone, created_at: user.created_at },
  profile: all(`SELECT * FROM profiles WHERE user_id = ${uid}`)[0] || null,
  goals: all(`SELECT * FROM goals WHERE user_id = ${uid}`),
  weighIns: all(`SELECT * FROM weigh_ins WHERE user_id = ${uid}`),
  meals: all(`SELECT * FROM meals WHERE user_id = ${uid}`),
  water: all(`SELECT * FROM water_logs WHERE user_id = ${uid}`),
  workouts: all(`SELECT * FROM workout_sessions WHERE user_id = ${uid}`),
  exerciseSets: all(
    `SELECT es.* FROM exercise_sets es JOIN workout_sessions ws ON ws.id = es.session_id WHERE ws.user_id = ${uid}`
  ),
  recipes: all(`SELECT * FROM recipes WHERE user_id = ${uid}`),
  recipeIngredients: all(
    `SELECT ri.* FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id WHERE r.user_id = ${uid}`
  ),
  treadmillPresets: all(`SELECT * FROM treadmill_presets WHERE user_id = ${uid}`),
  treadmillSessions: all(`SELECT * FROM treadmill_sessions WHERE user_id = ${uid}`),
  stepsDaily: all(`SELECT * FROM steps_daily WHERE user_id = ${uid}`),
  healthSyncs: all(`SELECT * FROM health_syncs WHERE user_id = ${uid}`),
  healthWorkouts: all(`SELECT * FROM health_workouts WHERE user_id = ${uid}`),
  recovery: all(`SELECT * FROM recovery_logs WHERE user_id = ${uid}`),
  progressPhotos: all(`SELECT * FROM progress_photos WHERE user_id = ${uid}`),
  photos: all(`SELECT * FROM photos WHERE user_id = ${uid}`),
  checkpoints: all(`SELECT * FROM daily_checkpoints WHERE user_id = ${uid}`),
};

exportData.photosBase64 = [];
for (const photo of exportData.photos) {
  const file = path.join(photoDir, String(uid), photo.filename);
  if (!fs.existsSync(file)) continue;
  exportData.photosBase64.push({
    id: photo.id,
    mime: photo.mime,
    filename: photo.filename,
    base64: fs.readFileSync(file).toString('base64'),
  });
}

const output = path.join(outDir, 'legacy-export.json');
fs.writeFileSync(output, JSON.stringify(exportData, null, 2));
const sha = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
const manifest = {
  exportedAt: exportData.exportedAt,
  database: dbPath,
  output,
  sha256: sha,
  counts: {
    profile: exportData.profile ? 1 : 0,
    goals: exportData.goals.length,
    weighIns: exportData.weighIns.length,
    meals: exportData.meals.length,
    water: exportData.water.length,
    workouts: exportData.workouts.length,
    exerciseSets: exportData.exerciseSets.length,
    recipes: exportData.recipes.length,
    treadmillSessions: exportData.treadmillSessions.length,
    stepsDaily: exportData.stepsDaily.length,
    healthWorkouts: exportData.healthWorkouts.length,
    recovery: exportData.recovery.length,
    checkpoints: exportData.checkpoints.length,
    photos: exportData.photosBase64.length,
  },
};
fs.writeFileSync(path.join(outDir, 'export-manifest.json'), JSON.stringify(manifest, null, 2));
db.close();
console.log(`Exported ${manifest.counts.photos} photos and ${exportData.checkpoints.length} checkpoints to ${output}`);
console.log(`SHA-256 ${sha}`);
