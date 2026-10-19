import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state.jsx';
import { api } from '../lib/api.js';
import { Panel, Button, StatusBadge, ProgressBar, Ring, Metric, Note, Empty, Sparkline } from '../components/ui.jsx';
import { ActivityRings, MacroBar } from '../components/charts.jsx';
import { WeighInModal, MealModal, WaterModal, TreadmillModal } from '../components/forms.jsx';
import {
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconDroplet,
  IconHeart,
  IconMeal,
  IconPlus,
  IconRefreshCw,
  IconShield,
  IconSteps,
  IconTreadmill,
  IconTrendingDown,
  IconWatch,
  IconClock,
} from '../components/icons.jsx';
import { fmtNum, fmtKg, fmtPct, fmtDate, fmtDateLong, fmtTime, fmtMinutes, relativeTime, signed, daysBetween } from '../lib/format.js';

const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', meal: 'Meal' };

export default function TodayPage() {
  const { bootstrap, refresh, user, toast } = useApp();
  const [stepHistory, setStepHistory] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [modal, setModal] = useState(null);
  const [calPreview, setCalPreview] = useState(0);

  const loadExtras = async () => {
    try {
      const [steps, sched] = await Promise.all([api.get('/steps'), api.get('/treadmill/schedule')]);
      setStepHistory(steps.rows || []);
      setSchedule(sched);
    } catch (err) {
      // Extras are non-critical; the main bootstrap already rendered.
    }
  };

  useEffect(() => {
    loadExtras();
  }, []);

  const reload = async () => {
    await refresh();
    await loadExtras();
  };

  if (!bootstrap) {
    return (
      <div className="page">
        <div className="panel" style={{ height: 320, display: 'grid', placeItems: 'center' }}>
          <span className="spinner" />
        </div>
      </div>
    );
  }

  const {
    today,
    goal,
    profile,
    nutrition,
    water,
    steps,
    weight,
    coach,
    progress,
    treadmill,
    workout,
    strength,
    recovery,
    health,
    nextCloseout,
  } = bootstrap;

  const todaySchedule = schedule?.days.find((d) => d.isToday);
  const split = todaySchedule?.split || '—';
  const caloriePct = goal ? Math.min(100, (nutrition.totals.calories / goal.calories) * 100) : 0;
  const proteinPct = goal ? Math.min(100, (nutrition.totals.protein / goal.protein_g) * 100) : 0;
  const waterPct = goal ? Math.min(100, (water.ml / goal.water_ml) * 100) : 0;
  const stepPct = goal ? Math.min(100, ((steps.qualifying_steps || 0) / goal.step_goal) * 100) : 0;
  const treadmillPct = todaySchedule
    ? Math.min(100, ((todaySchedule.completedMinutes || 0) / Math.max(1, todaySchedule.minMinutes || 30)) * 100)
    : 0;
  const calorieSeries = stepHistory.slice(-14);
  const hasMeals = nutrition.meals.length > 0;

  const daysToCheckpoint = profile ? daysBetween(today, profile.checkpoint_date) : null;
  const latestSession = treadmill.sessions[0];
  const rollup = todaySchedule?.met ? 'complete' : 'open';

  const quickActions = [
    { id: 'weight', label: 'Weigh in', icon: IconHeart },
    { id: 'meal', label: 'Log meal', icon: IconMeal },
    { id: 'water', label: '+ Water', icon: IconDroplet },
    { id: 'treadmill', label: 'Treadmill', icon: IconTreadmill },
  ];

  return (
    <div className="page stack">
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="hero-panel">
        <div className="today-hero">
          <div className="today-hero-main">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="eyebrow">{fmtDateLong(today)}</span>
              <span className="hero-dot" />
              <span className="eyebrow" style={{ color: 'var(--lime)' }}>
                Day {progress.elapsedDays + 1} of {progress.totalDays}
              </span>
              <span className="hero-dot" />
              <span className="eyebrow">{daysToCheckpoint} days to checkpoint</span>
            </div>

            <div className="today-hero-grid">
              <div>
                {weight.latest ? (
                  <div className="today-weight">
                    <span className="num">{fmtKg(weight.latest.weight_kg)}</span>
                    <span className="today-weight-unit">kg</span>
                  </div>
                ) : (
                  <div className="today-weight-empty">No weigh-in yet</div>
                )}
                <div className="today-weight-label">
                  Latest weigh-in{' '}
                  {weight.latest ? (
                    <span className="dim">· {fmtDate(weight.latest.date)}</span>
                  ) : (
                    <span className="dim">· not recorded</span>
                  )}
                </div>
                <div className="today-hero-chips">
                  <span className="chip">
                    <IconTrendingDown size={13} />
                    7-day avg <b className="mono">{fmtKg(weight.projection.currentAverage ?? weight.series.at(-1)?.rolling)}</b>
                  </span>
                  {weight.projection.weeklyRate != null && (
                    <span className="chip">
                      <b className="mono">{signed(weight.projection.weeklyRate, 2, ' kg')}</b>/wk
                    </span>
                  )}
                  <span className="chip">
                    <StatusBadge status={weight.status} short />
                  </span>
                </div>
              </div>

              <div className="today-projection">
                <span className="eyebrow">Dec 1 projection</span>
                {weight.projection.status === 'ok' ? (
                  <>
                    <div className="today-projection-range num">
                      {fmtKg(weight.projection.low)}–{fmtKg(weight.projection.high)}
                      <span className="unit">kg</span>
                    </div>
                    <div className="tiny dim">
                      Range, not a promise · {weight.projection.confidence} confidence
                    </div>
                  </>
                ) : (
                  <>
                    <div className="today-projection-range num" style={{ fontSize: 24, color: 'var(--text-muted)' }}>
                      Building
                    </div>
                    <div className="tiny dim">{weight.projection.message}</div>
                  </>
                )}
              </div>
            </div>

            <div className="timeline-strip" aria-label="Program timeline">
              <div className="timeline-strip-labels">
                <span>{profile ? fmtDate(profile.start_date) : 'Start'}</span>
                <span className="dim">Today · {fmtDate(today)}</span>
                <span>{profile ? fmtDate(profile.checkpoint_date) : 'Checkpoint'}</span>
              </div>
              <div className="timeline-strip-track">
                <div className="timeline-strip-fill" style={{ width: `${progress.pct}%` }} />
                <span className="timeline-strip-pin" style={{ left: `${progress.pct}%` }} />
              </div>
            </div>
          </div>

          <div className="today-hero-side">
            <ActivityRings
              size={188}
              stroke={14}
              rings={[
                { label: 'Calories', value: nutrition.totals.calories, max: goal?.calories || 2400, color: 'var(--lime)' },
                { label: 'Protein', value: nutrition.totals.protein, max: goal?.protein_g || 175, color: 'var(--teal)' },
                { label: 'Steps', value: steps.qualifying_steps || 0, max: goal?.step_goal || 10000, color: 'var(--violet)' },
              ]}
            />
            <div className="ring-legend">
              <div className="ring-legend-row">
                <span className="legend-swatch" style={{ background: 'var(--lime)' }} />
                <span>Calories</span>
                <b className="mono">{hasMeals ? fmtNum(nutrition.totals.calories) : '—'}</b>
                <span className="dim">/{fmtNum(goal?.calories)}</span>
              </div>
              <div className="ring-legend-row">
                <span className="legend-swatch" style={{ background: 'var(--teal)' }} />
                <span>Protein</span>
                <b className="mono">{hasMeals ? fmtNum(nutrition.totals.protein) : '—'}</b>
                <span className="dim">/{fmtNum(goal?.protein_g)}g</span>
              </div>
              <div className="ring-legend-row">
                <span className="legend-swatch" style={{ background: 'var(--violet)' }} />
                <span>Steps</span>
                <b className="mono">{fmtNum(steps.qualifying_steps)}</b>
                <span className="dim">/{fmtNum(goal?.step_goal)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="today-quick">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.id} className="quick-action" onClick={() => setModal(action.id)}>
                <span className="quick-action-icon"><Icon size={17} /></span>
                <span>{action.label}</span>
                <IconPlus size={14} className="quick-action-plus" />
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Coach                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section
        className="coach-strip"
        data-tone={coach.tone}
      >
        <div className="coach-strip-icon">
          {coach.tone === 'good' ? <IconCheck size={20} /> : <IconShield size={20} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <span className="eyebrow" style={{ color: 'inherit', opacity: 0.8 }}>Coach · evidence-based</span>
            <span className="coach-headline">{coach.headline}</span>
          </div>
          <p className="coach-copy">{coach.recommendation}</p>
          {coach.deadlineNote && <p className="coach-copy" style={{ marginTop: 6, opacity: 0.8 }}>{coach.deadlineNote}</p>}
        </div>
        <Link to="/transformation" className="btn btn-sm" style={{ flexShrink: 0 }}>
          See the data <IconArrowRight size={14} />
        </Link>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Step counters                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        title={
          <>
            <IconSteps size={16} /> Step accounting
          </>
        }
        sub="Only counter C advances your 10,000-step walking goal."
        action={<StatusBadge status={steps.status === 'estimated' ? 'ai_estimated' : steps.status === 'verified' ? 'verified_device' : 'pending_sync'} />}
      >
        <div className="counter-grid">
          <div className="counter-card">
            <span className="counter-letter">A</span>
            <div className="counter-label">Total HealthKit steps</div>
            <div className="counter-value num">{steps.total_steps == null ? '—' : fmtNum(steps.total_steps)}</div>
            <div className="counter-foot">All sources, de-duplicated</div>
          </div>
          <div className="counter-card">
            <span className="counter-letter">B</span>
            <div className="counter-label">Treadmill steps</div>
            <div className="counter-value num">{steps.treadmill_steps == null ? '—' : fmtNum(steps.treadmill_steps)}</div>
            <div className="counter-foot">Steps inside workout intervals</div>
          </div>
          <div className="counter-card counter-card-primary">
            <span className="counter-letter">C</span>
            <div className="counter-label">Qualifying daily steps</div>
            <div className="counter-value num">{steps.qualifying_steps == null ? '—' : fmtNum(steps.qualifying_steps)}</div>
            <div className="counter-foot">A − B · advances the goal</div>
          </div>
          <div className="counter-goal">
            <Ring
              value={steps.qualifying_steps || 0}
              max={goal?.step_goal || 10000}
              size={86}
              stroke={8}
              color="var(--violet)"
            >
              <span className="num" style={{ fontSize: 19 }}>{fmtPct(stepPct)}</span>
              <span className="tiny dim">of goal</span>
            </Ring>
            <div className="tiny dim" style={{ marginTop: 8, textAlign: 'center', maxWidth: 130 }}>
              {steps.uncertainty_pct
                ? `±${steps.uncertainty_pct}% uncertainty from overlapping sources`
                : 'Sources de-duplicated per minute'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <ProgressBar value={steps.qualifying_steps || 0} max={goal?.step_goal || 10000} tone="violet" height="tall" label="Qualifying steps" />
          <div className="row-between" style={{ marginTop: 8 }}>
            <span className="tiny dim">
              {steps.method === 'deduped_contested'
                ? `iPhone and Apple Watch covered some of the same minutes today. We keep one sample per minute rather than summing both — the disagreement is shown as uncertainty.`
                : 'HealthKit samples de-duplicated across devices.'}
            </span>
            <span className="tiny dim">Goal {fmtNum(goal?.step_goal)}</span>
          </div>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Two-column body                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="today-columns">
        <div className="stack">
          {/* Training */}
          <Panel
            title={
              <>
                <IconTreadmill size={16} /> Today's training
              </>
            }
            sub={todaySchedule ? `${todaySchedule.day} · ${todaySchedule.split}` : 'Weekly plan'}
            action={<Link to="/treadmill" className="btn btn-sm btn-ghost">Open treadmill <IconChevron /></Link>}
          >
            {todaySchedule ? (
              <>
                <div className="today-plan-row">
                  <div>
                    <div className="today-plan-split">{todaySchedule.split}</div>
                    <div className="small dim">{todaySchedule.intent}</div>
                  </div>
                  <div className="today-plan-target">
                    <span className="num">{todaySchedule.treadmillMin}</span>
                    <span className="tiny dim">min treadmill</span>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <div className="row-between" style={{ marginBottom: 6 }}>
                    <span className="tiny dim">
                      {workout.sessions.length > 0 ? `Gym: ${workout.sessions.map((w) => w.split).join(', ')} logged` : 'Gym session not logged yet'}
                    </span>
                    <span className="tiny dim">
                      Treadmill {treadmill.totals.minutes} / {todaySchedule.minMinutes || 0} min
                    </span>
                  </div>
                  <ProgressBar value={todaySchedule.completedMinutes || 0} max={Math.max(1, todaySchedule.minMinutes || 30)} />
                </div>
                {latestSession ? (
                  <div className="session-mini">
                    <div className="row" style={{ gap: 10 }}>
                      <span className="list-icon"><IconTreadmill size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="small" style={{ fontWeight: 600 }}>
                          {fmtMinutes(latestSession.duration_min)} · {latestSession.incline_pct ?? '—'}% incline
                        </div>
                        <div className="tiny dim">
                          {fmtTime(latestSession.start_time)} · {latestSession.speed_kmh ?? '—'} km/h ·{' '}
                          {latestSession.avg_hr ? `${latestSession.avg_hr} bpm avg` : 'no HR'}
                        </div>
                      </div>
                      <StatusBadge status={latestSession.evidence} short />
                    </div>
                  </div>
                ) : (
                  <div className="tiny dim" style={{ marginTop: 14 }}>
                    No treadmill session today. The plan is a suggestion, not a debt — missing it does not add minutes tomorrow.
                  </div>
                )}
                <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => setModal('treadmill')}>
                    <IconPlus size={14} /> Log session
                  </Button>
                  <Link to="/treadmill" className="btn btn-sm btn-ghost">Planner</Link>
                </div>
              </>
            ) : (
              <Empty title="Weekly plan unavailable">Add a profile to generate the split.</Empty>
            )}
          </Panel>

          {/* Nutrition */}
          <Panel
            title={
              <>
                <IconMeal size={16} /> Nutrition
              </>
            }
            sub={`${nutrition.meals.length} meal${nutrition.meals.length === 1 ? '' : 's'} logged today`}
            action={<Link to="/nutrition" className="btn btn-sm btn-ghost">Details <IconChevron /></Link>}
          >
            <div className="nutrition-top">
              <div>
                <Metric
                  label="Calories"
                  value={hasMeals ? fmtNum(nutrition.totals.calories) : '—'}
                  unit={`/ ${fmtNum(goal?.calories)}`}
                  foot={<span className="tiny dim">{hasMeals ? `${signed(nutrition.totals.calories - (goal?.calories || 0), 0, ' kcal')} vs target` : 'Not recorded'}</span>}
                />
                <div style={{ marginTop: 10 }}>
                  <ProgressBar value={nutrition.totals.calories} max={goal?.calories || 2400} />
                </div>
              </div>
              <div>
                <Metric
                  label="Protein"
                  value={hasMeals ? fmtNum(nutrition.totals.protein) : '—'}
                  unit={`/ ${fmtNum(goal?.protein_g)} g`}
                  accent="var(--teal)"
                  foot={<span className="tiny dim">{hasMeals ? `${fmtPct(proteinPct)} of target` : 'Not recorded'}</span>}
                />
                <div style={{ marginTop: 10 }}>
                  <ProgressBar value={nutrition.totals.protein} max={goal?.protein_g || 175} tone="" />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              {hasMeals ? (
                <MacroBar protein={nutrition.totals.protein} carbs={nutrition.totals.carbs} fat={nutrition.totals.fat} />
              ) : (
                <div className="tiny dim">No meals logged yet — macros appear once you log something.</div>
              )}
            </div>

            <div className="list" style={{ marginTop: 12 }}>
              {nutrition.meals.length === 0 && (
                <div className="tiny dim" style={{ padding: '10px 0' }}>
                  Nothing logged yet. Logging is optional, but a gap is shown as “not recorded”, not as zero calories.
                </div>
              )}
              {nutrition.meals.slice(0, 4).map((meal) => (
                <div className="list-row" key={meal.id}>
                  <span className="list-icon"><IconMeal size={15} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small truncate">{meal.name}</div>
                    <div className="tiny dim">
                      {SLOT_LABELS[meal.slot] || meal.slot} · {fmtNum(meal.calories)} kcal · {fmtNum(meal.protein_g)}g protein
                    </div>
                  </div>
                  <span className="badge" data-tone="logged">Logged</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Water + recovery */}
          <div className="two-up">
            <Panel title={<><IconDroplet size={16} /> Hydration</>} sub="Self-reported" className="compact-panel">
              <div className="row-between" style={{ marginBottom: 10 }}>
                <div className="num" style={{ fontSize: 26 }}>
                  {fmtNum(water.ml)}<span className="unit" style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>/ {fmtNum(goal?.water_ml)} ml</span>
                </div>
                <button className="icon-btn" onClick={() => setModal('water')} aria-label="Add water"><IconPlus size={16} /></button>
              </div>
              <ProgressBar value={water.ml} max={goal?.water_ml || 3000} />
              <div className="tiny dim" style={{ marginTop: 8 }}>{fmtPct(waterPct)} of daily target</div>
            </Panel>

            <Panel title={<><IconHeart size={16} /> Recovery</>} sub="Sleep and readiness" className="compact-panel">
              {recovery.status === 'ok' ? (
                <>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <div className="num" style={{ fontSize: 26 }}>
                      {recovery.avgSleep ?? '—'}<span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>h sleep</span>
                    </div>
                    <span className="chip">{recovery.trend}</span>
                  </div>
                  <div className="tiny dim">Readiness {recovery.avgReadiness ?? '—'}/5 · soreness {recovery.avgSoreness ?? '—'}/5</div>
                  <Link to="/training" className="tiny" style={{ color: 'var(--lime)', display: 'inline-block', marginTop: 8 }}>
                    Log recovery check-in →
                  </Link>
                </>
              ) : (
                <div className="tiny dim">No recovery data yet. Log sleep and readiness on the Training page.</div>
              )}
            </Panel>
          </div>
        </div>

        <div className="stack">
          {/* 14-day qualifying steps */}
          <Panel title="Qualifying steps · 14 days" sub="Treadmill steps excluded" action={<span className="chip">C only</span>}>
            <div className="spark-wrap">
              <Sparkline values={calorieSeries.map((d) => d.qualifying_steps)} width={320} height={64} color="var(--violet)" />
            </div>
            <div className="row-between" style={{ marginTop: 10 }}>
              <div>
                <div className="tiny dim">7-day average</div>
                <div className="num" style={{ fontSize: 22 }}>
                  {fmtNum(average(calorieSeries.slice(-7).map((d) => d.qualifying_steps)))}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="tiny dim">Days at goal</div>
                <div className="num" style={{ fontSize: 22 }}>
                  {calorieSeries.filter((d) => (d.qualifying_steps || 0) >= (goal?.step_goal || 10000)).length}
                  <span className="tiny dim">/{calorieSeries.length}</span>
                </div>
              </div>
            </div>
          </Panel>

          {/* Evidence */}
          <Panel
            title={<><IconShield size={16} /> Evidence status</>}
            sub="How today's numbers came to exist"
            action={<Link to="/evidence" className="btn btn-sm btn-ghost">Audit <IconChevron /></Link>}
          >
            <div className="evidence-list">
              <EvidenceRow label="Nutrition" status={nutrition.meals.length ? 'logged_user' : 'not_recorded'} detail={`${nutrition.meals.length} meals`} />
              <EvidenceRow label="Workout" status={workout.status} detail={workout.sessions.length ? `${workout.sessions.length} session(s)` : 'not logged'} />
              <EvidenceRow label="Treadmill" status={treadmill.sessions.some((s) => s.evidence === 'verified_device') ? 'verified_device' : treadmill.sessions.length ? treadmill.sessions[0].evidence : 'not_recorded'} detail={`${treadmill.totals.minutes} min`} />
              <EvidenceRow label="Steps" status={steps.status === 'estimated' ? 'ai_estimated' : steps.status === 'verified' ? 'verified_device' : 'pending_sync'} detail={steps.status} />
              <EvidenceRow label="Body weight" status={weight.status} detail={weight.latest ? `${fmtKg(weight.latest.weight_kg)} kg` : 'not recorded'} />
            </div>
            <div className="health-sync-row">
              <span className={`sync-dot ${health.stale ? 'stale' : ''}`} />
              <div style={{ flex: 1 }}>
                <div className="tiny" style={{ fontWeight: 600 }}>
                  {health.stale ? 'Apple Health pending sync' : 'Apple Health synced'}
                </div>
                <div className="tiny dim">
                  {health.lastSync ? `Last import ${relativeTime(health.lastSync)}` : 'No HealthKit import yet'}
                </div>
              </div>
              <IconWatch size={16} style={{ color: 'var(--text-dim)' }} />
            </div>
          </Panel>

          {/* Closeout */}
          <Panel title={<><IconClock size={16} /> Daily closeout</>} sub="11:55 PM Asia/Kolkata">
            <div className="row-between">
              <div>
                <div className="tiny dim">Next automatic checkpoint</div>
                <div className="small" style={{ fontWeight: 600, marginTop: 2 }}>
                  {nextCloseout ? fmtDateTime(nextCloseout) : '—'}
                </div>
              </div>
              <Link to="/evidence" className="btn btn-sm">
                History
              </Link>
            </div>
            <div className="tiny dim" style={{ marginTop: 10 }}>
              Snapshots are immutable. When late HealthKit data arrives, a reconciled layer is added without rewriting what was known at 11:55 PM.
            </div>
            <Button
              size="sm"
              variant="ghost"
              style={{ marginTop: 10 }}
              onClick={async () => {
                try {
                  const res = await api.post('/checkpoints', { date: today });
                  toast(res.created ? 'Checkpoint created for today' : 'Checkpoint already exists for today', 'success');
                  await reload();
                } catch (err) {
                  toast(err.message, 'error');
                }
              }}
            >
              <IconRefreshCw size={13} /> Create snapshot now
            </Button>
          </Panel>

          {/* Strength */}
          <Panel title="Strength retention" sub="Recent block vs baseline" action={<span className="chip">{strength.status === 'ok' ? `${strength.score}%` : 'Building'}</span>}>
            {strength.status === 'ok' ? (
              <>
                <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
                  <span className="num" style={{ fontSize: 40 }}>{strength.score}</span>
                  <span className="small dim" style={{ paddingBottom: 5 }}>/100</span>
                  <span className={`badge ${strength.score >= 95 ? '' : ''}`} data-tone={strength.score >= 95 ? 'verified' : strength.score >= 90 ? 'pending' : 'review'} style={{ marginLeft: 'auto', marginBottom: 6 }}>
                    {strength.label}
                  </span>
                </div>
                <div className="strength-lifts">
                  {strength.lifts.slice(0, 3).map((lift) => (
                    <div key={lift.exercise} className="strength-lift">
                      <span className="truncate">{titleCase(lift.exercise)}</span>
                      <span className="mono">{lift.retention}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="tiny dim">{strength.message || 'Log the same lifts across two blocks to compute retention.'}</div>
            )}
          </Panel>
        </div>
      </div>

      <WeighInModal open={modal === 'weight'} onClose={() => setModal(null)} onSaved={reload} initial={weight.latest} />
      <MealModal open={modal === 'meal'} onClose={() => setModal(null)} onSaved={reload} date={today} />
      <WaterModal open={modal === 'water'} onClose={() => setModal(null)} onSaved={reload} date={today} />
      <TreadmillModal
        open={modal === 'treadmill'}
        onClose={() => setModal(null)}
        onSaved={reload}
        date={today}
        presets={[]}
      />
    </div>
  );
}

function EvidenceRow({ label, status, detail }) {
  return (
    <div className="evidence-row">
      <span className="small">{label}</span>
      <span className="tiny dim truncate" style={{ textAlign: 'right' }}>{detail}</span>
      <StatusBadge status={status} short />
    </div>
  );
}

function IconChevron() {
  return <IconArrowRight size={13} />;
}

function average(values) {
  const clean = values.filter((v) => v != null);
  if (!clean.length) return null;
  return Math.round(clean.reduce((a, b) => a + b, 0) / clean.length);
}

function titleCase(s = '') {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
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
