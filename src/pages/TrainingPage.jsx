import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Panel, Button, StatusBadge, ProgressBar, Metric, Modal, Field, Empty, Note, Ring } from '../components/ui.jsx';
import { LineChart } from '../components/charts.jsx';
import { TreadmillModal } from '../components/forms.jsx';
import {
  IconActivity,
  IconCheck,
  IconDumbbell,
  IconHeart,
  IconMoon,
  IconPlus,
  IconTrash,
  IconTreadmill,
  IconTrendingUp,
  IconAlert,
} from '../components/icons.jsx';
import { fmtNum, fmtDate, fmtMinutes, fmtWeekday, addDays, daysBetween } from '../lib/format.js';

const SPLIT_ORDER = ['Push', 'Pull', 'Legs', 'Recovery', 'Shoulders', 'Arms', 'Rest'];
const SPLIT_SUGGESTIONS = {
  Push: ['Incline DB Press', 'Cable Fly', 'Overhead Press', 'Lateral Raise'],
  Pull: ['Lat Pulldown', 'Chest-Supported Row', 'Face Pull', 'Curl'],
  Legs: ['Hack Squat', 'Romanian Deadlift', 'Leg Extension', 'Calf Raise'],
  Recovery: [],
  Shoulders: ['Shoulder Press', 'Lateral Raise', 'Rear Delt Fly'],
  Arms: ['Curl', 'Triceps Pushdown', 'Hammer Curl'],
  Rest: [],
};

export default function TrainingPage() {
  const { toast, bootstrap } = useApp();
  const [workouts, setWorkouts] = useState([]);
  const [strength, setStrength] = useState(null);
  const [recovery, setRecovery] = useState({ rows: [], trend: null });
  const [schedule, setSchedule] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [treadOpen, setTreadOpen] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState(null);

  const load = async () => {
    try {
      const [w, s, r, sched] = await Promise.all([
        api.get('/workouts?from=' + shiftDays(-90)),
        api.get('/workouts/strength'),
        api.get('/recovery'),
        api.get('/treadmill/schedule'),
      ]);
      setWorkouts(w.sessions || []);
      setStrength(s);
      setRecovery(r);
      setSchedule(sched);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const today = bootstrap?.today;
  const todaySchedule = schedule?.days.find((d) => d.isToday);
  const todaySplit = todaySchedule?.split || 'Rest';
  const todayWorkout = workouts.find((w) => w.date === today);
  const todayRecovery = recovery.rows.find((r) => r.date === today);

  const exercises = useMemo(() => {
    const map = new Map();
    for (const session of workouts) {
      for (const set of session.sets || []) {
        const key = set.exercise.toLowerCase();
        if (!map.has(key)) map.set(key, { name: set.exercise, points: new Map() });
        const e1rm = set.reps === 1 ? set.weight_kg : set.weight_kg * (1 + set.reps / 30);
        const entry = map.get(key);
        const best = entry.points.get(session.date) || 0;
        entry.points.set(session.date, Math.max(best, e1rm));
      }
    }
    return [...map.values()]
      .map((e) => ({
        name: e.name,
        key: e.name.toLowerCase(),
        points: [...e.points.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, y]) => ({ x: date, y: Math.round(y * 10) / 10 })),
      }))
      .sort((a, b) => b.points.length - a.points.length);
  }, [workouts]);

  useEffect(() => {
    if (!selectedExercise && exercises.length) setSelectedExercise(exercises[0].key);
  }, [exercises, selectedExercise]);

  const activeExercise = exercises.find((e) => e.key === selectedExercise);
  const weeklyWorkouts = workouts.filter((w) => w.date >= shiftDays(-6) && w.date <= today);
  const weekDays = useMemo(() => {
    const monday = mondayOf(today);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [today]);

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Push · Pull · Legs · Recovery · Shoulders · Arms · Rest</div>
          <h1 className="page-title">Training</h1>
          <p className="lede">
            Resistance work is the anchor. Cardio supports it — it does not replace it. Every logged set is kept as
            your own record, and HealthKit strength workouts are labelled separately.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => setRecoveryOpen(true)}><IconMoon size={14} /> Recovery check-in</Button>
          <Button size="sm" variant="primary" onClick={() => setLogOpen(true)}><IconPlus size={14} /> Log workout</Button>
        </div>
      </div>

      {/* Week split */}
      <Panel title="This week's split" sub={`${fmtDate(weekDays[0])} – ${fmtDate(weekDays[6])}`} action={<span className="chip">{weeklyWorkouts.length} sessions logged</span>}>
        <div className="split-week">
          {weekDays.map((date) => {
            const session = workouts.find((w) => w.date === date);
            const isToday = date === today;
            const dayIndex = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
            const planned = schedule?.days[dayIndex];
            return (
              <div key={date} className={`split-day ${isToday ? 'split-day-today' : ''} ${session ? 'split-day-done' : ''}`}>
                <span className="split-day-name">{fmtWeekday(date)}</span>
                <span className="split-day-date">{fmtDate(date)}</span>
                <div className={`split-day-badge ${session ? 'has-session' : ''}`}>
                  {session ? <IconCheck size={15} /> : <IconDumbbell size={15} />}
                </div>
                <span className="split-day-split">{session?.split || planned?.split || '—'}</span>
                <span className="tiny dim">{session ? `${Math.round(session.duration_min || 0)} min` : planned?.optional ? 'optional' : planned?.treadmillMin ? `+ ${planned.treadmillMin}m cardio` : 'rest'}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="training-grid">
        <div className="stack">
          {/* Today */}
          <Panel
            title={<><IconActivity size={16} /> Today · {todaySplit}</>}
            sub={todaySchedule?.intent || 'Planned by your weekly split'}
          >
            {todayWorkout ? (
              <div className="stack" style={{ gap: 12 }}>
                <div className="today-workout-head">
                  <div>
                    <div className="today-workout-title">{todayWorkout.split}</div>
                    <div className="tiny dim">
                      {todayWorkout.sets?.length || 0} sets · {todayWorkout.duration_min || '—'} min · source{' '}
                      {todayWorkout.source === 'healthkit' ? 'HealthKit' : 'manual'}
                    </div>
                  </div>
                  <span className="badge" data-tone={todayWorkout.health_workout_id ? 'verified' : 'logged'}>
                    {todayWorkout.health_workout_id ? 'Device linked' : 'Logged by user'}
                  </span>
                </div>
                <div className="set-list">
                  {groupSets(todayWorkout.sets || []).map((group) => (
                    <div className="set-group" key={group.exercise}>
                      <div className="set-group-name">{group.exercise}</div>
                      <div className="set-group-sets">
                        {group.sets.map((s) => (
                          <span className="set-chip" key={s.id}>
                            {s.reps} × {s.weight_kg} kg
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="today-workout-empty">
                <div>
                  <div className="today-workout-title">{todaySplit}</div>
                  <div className="small dim" style={{ marginTop: 4 }}>
                    {todaySplit === 'Rest' || todaySplit === 'Recovery'
                      ? 'Recovery is part of the programme. Nothing needs to be “made up”.'
                      : `Suggested: ${SPLIT_SUGGESTIONS[todaySplit]?.slice(0, 3).join(' · ') || 'your usual session'}`}
                  </div>
                </div>
                <Button size="sm" onClick={() => setLogOpen(true)}><IconPlus size={14} /> Log session</Button>
              </div>
            )}

            {todaySchedule?.treadmillMin && (
              <div className="cardio-hint">
                <IconTreadmill size={15} />
                <div style={{ flex: 1 }}>
                  <div className="small" style={{ fontWeight: 600 }}>Today's cardio · {todaySchedule.treadmillMin} min</div>
                  <div className="tiny dim">{todaySchedule.mode} · {todaySchedule.intent}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setTreadOpen(true)}>Log</Button>
              </div>
            )}
          </Panel>

          {/* Strength progression */}
          <Panel
            title="Strength progression"
            sub="Best estimated 1RM per session (Epley formula)"
            action={
              <select className="select" style={{ width: 190, height: 32 }} value={selectedExercise || ''} onChange={(e) => setSelectedExercise(e.target.value)}>
                {exercises.map((e) => <option key={e.key} value={e.key}>{e.name}</option>)}
                {exercises.length === 0 && <option>No lifts logged</option>}
              </select>
            }
          >
            {activeExercise && activeExercise.points.length >= 2 ? (
              <>
                <LineChart
                  height={210}
                  series={[{ label: activeExercise.name, color: 'var(--lime)', points: activeExercise.points, dots: true }]}
                  yFormat={(v) => `${v.toFixed(0)}`}
                  xFormat={(d) => fmtDate(d)}
                  referenceLine={Math.max(...activeExercise.points.map((p) => p.y)) * 0.9}
                  referenceLabel="−10%"
                />
                <div className="legend" style={{ marginTop: 8 }}>
                  <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--lime)' }} />Estimated 1RM</span>
                  <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--teal)' }} />Retention floor</span>
                </div>
              </>
            ) : (
              <Empty title="Log at least two sessions with the same lift">
                Progression appears when the same exercise has been recorded more than once.
              </Empty>
            )}
          </Panel>

          {/* History */}
          <Panel title="Session history" sub={`${workouts.length} sessions in the last 90 days`} flush>
            {workouts.length === 0 ? (
              <Empty title="No workouts logged yet">Your first session will appear here.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Split</th>
                      <th>Sets</th>
                      <th>Top set</th>
                      <th>Duration</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workouts.slice(0, 20).map((w) => {
                      const top = [...(w.sets || [])].sort((a, b) => b.weight_kg - a.weight_kg)[0];
                      return (
                        <tr key={w.id}>
                          <td>{fmtDate(w.date)}</td>
                          <td><span className="badge" data-tone="logged">{w.split}</span></td>
                          <td className="mono">{w.sets?.length || 0}</td>
                          <td className="mono">{top ? `${top.exercise} · ${top.weight_kg} kg × ${top.reps}` : '—'}</td>
                          <td className="mono">{w.duration_min ? `${w.duration_min}m` : '—'}</td>
                          <td><StatusBadge status={w.health_workout_id ? 'verified_device' : 'logged_user'} short /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="stack">
          {/* Strength retention */}
          <Panel title="Strength retention" sub="Recent 14 days vs baseline block">
            {strength?.status === 'ok' ? (
              <>
                <div className="retention-hero">
                  <Ring value={strength.score} max={100} size={108} stroke={9} color={strength.score >= 95 ? 'var(--lime)' : strength.score >= 90 ? 'var(--amber)' : 'var(--red)'}>
                    <span className="num" style={{ fontSize: 28 }}>{strength.score}</span>
                    <span className="tiny dim">/100</span>
                  </Ring>
                  <div>
                    <div className="small" style={{ fontWeight: 600 }}>{strength.label}</div>
                    <div className="tiny dim" style={{ marginTop: 4, lineHeight: 1.5 }}>
                      100 means your estimated 1RM is unchanged. Below 90% is a signal to protect recovery before cutting further.
                    </div>
                  </div>
                </div>
                <div className="retention-list">
                  {strength.lifts.map((l) => (
                    <div className="retention-row" key={l.exercise}>
                      <span className="truncate">{l.exercise}</span>
                      <span className="tiny dim mono">{l.baseline} → {l.current} kg</span>
                      <span className={`tiny mono ${l.retention >= 95 ? 'delta-up' : l.retention >= 90 ? 'delta-flat' : 'delta-down'}`}>{l.retention}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="small dim">{strength?.message || 'Log the same lifts in two separate blocks to compute retention.'}</div>
            )}
          </Panel>

          {/* Recovery */}
          <Panel
            title={<><IconMoon size={16} /> Recovery</>}
            sub="Sleep, readiness and soreness"
            action={<Button size="sm" variant="ghost" onClick={() => setRecoveryOpen(true)}>{todayRecovery ? 'Edit' : 'Log'}</Button>}
          >
            {todayRecovery ? (
              <div className="recovery-today">
                <div className="recovery-today-grid">
                  <div><span className="eyebrow">Sleep</span><div className="num">{todayRecovery.sleep_hours != null ? Number(todayRecovery.sleep_hours).toFixed(1) : '—'}<span className="stat-unit">h</span></div></div>
                  <div><span className="eyebrow">Readiness</span><div className="num">{todayRecovery.readiness ?? '—'}<span className="stat-unit">/5</span></div></div>
                  <div><span className="eyebrow">Soreness</span><div className="num">{todayRecovery.soreness ?? '—'}<span className="stat-unit">/5</span></div></div>
                  <div><span className="eyebrow">Resting HR</span><div className="num">{todayRecovery.resting_hr ?? '—'}<span className="stat-unit">bpm</span></div></div>
                </div>
                {todayRecovery.notes && <p className="tiny dim" style={{ marginTop: 10 }}>{todayRecovery.notes}</p>}
              </div>
            ) : (
              <div className="small dim">No check-in today. It takes under a minute and makes the coach's read far more useful.</div>
            )}

            <div style={{ marginTop: 16 }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span className="eyebrow">28-day trend</span>
                <span className="chip">{recovery.trend?.trend || '—'}</span>
              </div>
              {recovery.rows.length >= 2 ? (
                <LineChart
                  height={130}
                  series={[
                    { label: 'Sleep (h)', color: 'var(--teal)', points: recovery.rows.filter((r) => r.sleep_hours != null).map((r) => ({ x: r.date, y: r.sleep_hours })) },
                    { label: 'Readiness (×2h)', color: 'var(--lime)', points: recovery.rows.filter((r) => r.readiness != null).map((r) => ({ x: r.date, y: r.readiness * 2 })), dashed: true },
                  ]}
                  yFormat={(v) => v.toFixed(0)}
                  xFormat={(d) => fmtDate(d)}
                />
              ) : (
                <div className="tiny dim">Two check-ins unlock the trend.</div>
              )}
            </div>
          </Panel>

          {/* Guardrail */}
          <Panel title="Load guardrails" sub="Automatic checks">
            <div className="stack" style={{ gap: 9 }}>
              <div className="guardrail-row">
                <IconCheck size={14} style={{ color: 'var(--lime)' }} />
                <span className="small muted">Cardio never increases because a session was missed.</span>
              </div>
              <div className="guardrail-row">
                <IconCheck size={14} style={{ color: 'var(--lime)' }} />
                <span className="small muted">A strength drop over 8% triggers a deficit review, not more cardio.</span>
              </div>
              <div className="guardrail-row">
                <IconCheck size={14} style={{ color: 'var(--lime)' }} />
                <span className="small muted">Readiness under 2.5/5 keeps treadmill work conversational.</span>
              </div>
              <div className="guardrail-row">
                <IconAlert size={14} style={{ color: 'var(--amber)' }} />
                <span className="small muted">Joint pain is a stop signal — log it and reduce load.</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <WorkoutModal open={logOpen} onClose={() => setLogOpen(false)} onSaved={load} date={today} split={todaySplit} suggestions={SPLIT_SUGGESTIONS[todaySplit] || []} />
      <RecoveryModal open={recoveryOpen} onClose={() => setRecoveryOpen(false)} onSaved={load} date={today} existing={todayRecovery} />
      <TreadmillModal open={treadOpen} onClose={() => setTreadOpen(false)} onSaved={load} date={today} presets={[]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workout modal                                                       */
/* ------------------------------------------------------------------ */

function WorkoutModal({ open, onClose, onSaved, date, split, suggestions }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ date, split, durationMin: '', notes: '' });
  const [exercises, setExercises] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ date, split, durationMin: '', notes: '' });
      setExercises(
        (suggestions.length ? suggestions.slice(0, 3) : ['Exercise']).map((name) => ({
          name,
          sets: [{ reps: 8, weightKg: 20 }],
        }))
      );
    }
  }, [open, date, split, suggestions]);

  const updateExercise = (index, patch) => {
    setExercises((list) => list.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const updateSet = (ei, si, patch) => {
    setExercises((list) =>
      list.map((e, i) =>
        i === ei ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e
      )
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const sets = exercises.flatMap((e) =>
        e.sets
          .filter((s) => Number(s.reps) > 0 && Number(s.weightKg) >= 0)
          .map((s) => ({ exercise: e.name, reps: Number(s.reps), weightKg: Number(s.weightKg) }))
      );
      await api.post('/workouts', {
        date: form.date,
        split: form.split,
        durationMin: form.durationMin === '' ? null : Number(form.durationMin),
        notes: form.notes || null,
        sets,
      });
      toast('Workout logged', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log workout" sub="Sets, reps and weights are saved exactly as you enter them." wide>
      <div className="form-grid">
        <Field label="Date">
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Split">
          <select className="select" value={form.split} onChange={(e) => setForm({ ...form, split: e.target.value })}>
            {SPLIT_ORDER.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Duration (min)">
          <input className="input" type="number" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} />
        </Field>
      </div>

      <div className="exercise-form">
        {exercises.map((exercise, ei) => (
          <div className="exercise-block" key={ei}>
            <div className="exercise-block-head">
              <input
                className="input"
                value={exercise.name}
                onChange={(e) => updateExercise(ei, { name: e.target.value })}
                placeholder="Exercise name"
              />
              <button className="icon-btn" onClick={() => setExercises((l) => l.filter((_, i) => i !== ei))} aria-label="Remove exercise">
                <IconTrash size={15} />
              </button>
            </div>
            <div className="set-editor">
              <span className="tiny dim">Set</span>
              <span className="tiny dim">Reps</span>
              <span className="tiny dim">Weight (kg)</span>
              <span />
              {exercise.sets.map((set, si) => (
                <React.Fragment key={si}>
                  <span className="tiny dim mono">{si + 1}</span>
                  <input className="input" type="number" value={set.reps} onChange={(e) => updateSet(ei, si, { reps: e.target.value })} aria-label="Reps" />
                  <input className="input" type="number" step="0.5" value={set.weightKg} onChange={(e) => updateSet(ei, si, { weightKg: e.target.value })} aria-label="Weight" />
                  <button
                    className="icon-btn"
                    onClick={() => updateExercise(ei, { sets: exercise.sets.filter((_, j) => j !== si) })}
                    aria-label="Remove set"
                  >
                    <IconTrash size={13} />
                  </button>
                </React.Fragment>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => updateExercise(ei, { sets: [...exercise.sets, { reps: 8, weightKg: 20 }] })}>
              <IconPlus size={13} /> Add set
            </Button>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <Button size="sm" variant="ghost" onClick={() => setExercises((l) => [...l, { name: 'Exercise', sets: [{ reps: 8, weightKg: 20 }] }])}>
          <IconPlus size={14} /> Add exercise
        </Button>
      </div>

      <Field label="Session notes" style={{ marginTop: 14 }}>
        <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="How did it feel? Any joint issues?" />
      </Field>

      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Save workout</Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Recovery modal                                                     */
/* ------------------------------------------------------------------ */

function RecoveryModal({ open, onClose, onSaved, date, existing }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    date,
    sleepHours: '',
    restingHr: '',
    soreness: 3,
    readiness: 3,
    stress: 3,
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        date: existing?.date || date,
        sleepHours: existing?.sleep_hours ?? '',
        restingHr: existing?.resting_hr ?? '',
        soreness: existing?.soreness ?? 3,
        readiness: existing?.readiness ?? 3,
        stress: existing?.stress ?? 3,
        notes: existing?.notes || '',
      });
    }
  }, [open, existing, date]);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/recovery', {
        date: form.date,
        sleepHours: form.sleepHours === '' ? null : Number(form.sleepHours),
        restingHr: form.restingHr === '' ? null : Number(form.restingHr),
        soreness: Number(form.soreness),
        readiness: Number(form.readiness),
        stress: Number(form.stress),
        notes: form.notes || null,
      });
      toast('Recovery check-in saved', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const scale = (key) => (
    <div className="scale-input">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={Number(form[key]) === n ? 'scale-btn scale-active' : 'scale-btn'}
          onClick={() => setForm({ ...form, [key]: n })}
        >
          {n}
        </button>
      ))}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Recovery check-in" sub="Subjective but useful. Readiness is yours to judge.">
      <div className="form-grid">
        <Field label="Date">
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Sleep (hours)">
          <input className="input" type="number" step="0.1" value={form.sleepHours} onChange={(e) => setForm({ ...form, sleepHours: e.target.value })} />
        </Field>
        <Field label="Resting HR (bpm)">
          <input className="input" type="number" value={form.restingHr} onChange={(e) => setForm({ ...form, restingHr: e.target.value })} />
        </Field>
      </div>

      <div className="form-grid" style={{ marginTop: 14 }}>
        <Field label="Readiness (1–5)">{scale('readiness')}</Field>
        <Field label="Soreness (1–5)">{scale('soreness')}</Field>
        <Field label="Stress (1–5)">{scale('stress')}</Field>
      </div>

      <Field label="Notes" style={{ marginTop: 14 }}>
        <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Slept badly, legs heavy, felt strong…" />
      </Field>

      <Note tone="info" icon={<IconHeart size={15} />}>
        This is self-reported data. It is labelled as such and never presented as a device measurement.
      </Note>

      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Save check-in</Button>
      </div>
    </Modal>
  );
}

function groupSets(sets) {
  const map = new Map();
  for (const set of sets) {
    if (!map.has(set.exercise)) map.set(set.exercise, []);
    map.get(set.exercise).push(set);
  }
  return [...map.entries()].map(([exercise, list]) => ({ exercise, sets: list }));
}

function shiftDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
