import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import {
  Panel,
  Button,
  StatusBadge,
  ProgressBar,
  Metric,
  Note,
  Empty,
  Modal,
  Field,
  Tabs,
  Segmented,
} from '../components/ui.jsx';
import { HrZones, BarChart } from '../components/charts.jsx';
import { TreadmillModal } from '../components/forms.jsx';
import {
  IconAlert,
  IconCamera,
  IconCheck,
  IconClock,
  IconEdit,
  IconInfo,
  IconPause,
  IconPlay,
  IconPlus,
  IconRefreshCw,
  IconTreadmill,
  IconTrash,
  IconTrendingUp,
} from '../components/icons.jsx';
import { fmtNum, fmtMinutes, fmtDate, fmtTime, fmtPct, relativeTime, signed, fmtDateTime, dateKeyInZone } from '../lib/format.js';
import { PhotoImage } from '../components/PhotoImage.jsx';

const BLOCK_TONES = { warmup: 'warmup', main: 'main', cooldown: 'cooldown' };

export default function TreadmillPage() {
  const { toast, bootstrap, dataVersion } = useApp();
  const [tab, setTab] = useState('planner');
  const [presets, setPresets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [totals, setTotals] = useState({ minutes: 0, distance: 0, sessions: 0, calories: 0 });
  const [schedule, setSchedule] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [consoleSession, setConsoleSession] = useState(null);
  const [editSession, setEditSession] = useState(null);
  const [detailSession, setDetailSession] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ocrAvailable, setOcrAvailable] = useState(true);

  const load = async () => {
    try {
      const [presetRes, sessionRes, scheduleRes, weeklyRes] = await Promise.all([
        api.get('/treadmill/presets'),
        api.get('/treadmill/sessions?from=' + shiftDays(-90)),
        api.get('/treadmill/schedule'),
        api.get('/treadmill/weekly'),
      ]);
      setPresets(presetRes.presets);
      setSessions(sessionRes.sessions);
      setTotals(sessionRes.totals);
      setSchedule(scheduleRes);
      setWeekly(weeklyRes.weeks);
      if (presetRes.presets.length) {
        const preferred = presetRes.presets.find((p) => p.is_default) || presetRes.presets[0];
        setSelectedId((current) => current || preferred.id);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
  }, [dataVersion]);

  useEffect(() => {
    if (!selectedId) return;
    const preset = presets.find((p) => p.id === selectedId);
    if (preset) setDraft({ ...preset, blocks: preset.blocks.map((b) => ({ ...b })) });
  }, [selectedId, presets]);

  const timeline = useMemo(() => {
    if (!draft) return { blocks: [], totalMinutes: 0 };
    let cursor = 0;
    const blocks = draft.blocks.map((b) => {
      const start = cursor;
      cursor += Number(b.minutes) || 0;
      return { ...b, startMin: start, endMin: cursor };
    });
    return { blocks, totalMinutes: cursor };
  }, [draft]);

  const totalMinutes = timeline.totalMinutes;
  const avgSpeed = totalMinutes
    ? timeline.blocks.reduce((s, b) => s + ((Number(b.speedMin) + Number(b.speedMax)) / 2) * b.minutes, 0) / totalMinutes
    : 0;
  const avgIncline = totalMinutes
    ? timeline.blocks.reduce((s, b) => s + ((Number(b.inclineMin) + Number(b.inclineMax)) / 2) * b.minutes, 0) / totalMinutes
    : 0;
  const estimatedDistance = totalMinutes ? (avgSpeed * totalMinutes) / 60 : 0;

  const savePreset = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.put(`/treadmill/presets/${draft.id}`, {
        name: draft.name,
        description: draft.description,
        blocks: draft.blocks,
      });
      toast('Preset updated', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveAsNew = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.post('/treadmill/presets', {
        name: `${draft.name} copy`,
        description: draft.description,
        blocks: draft.blocks,
      });
      toast('Saved as a new preset', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateBlock = (index, key, value) => {
    setDraft((d) => {
      const blocks = d.blocks.map((b, i) => (i === index ? { ...b, [key]: value } : b));
      return { ...d, blocks };
    });
  };

  const addBlock = () => {
    setDraft((d) => ({
      ...d,
      blocks: [
        ...d.blocks.slice(0, -1),
        {
          id: `custom-${Date.now()}`,
          label: 'Extra block',
          minutes: 5,
          speedMin: 3.5,
          speedMax: 4.5,
          inclineMin: 5,
          inclineMax: 8,
          color: 'main',
          note: '',
        },
        ...d.blocks.slice(-1),
      ],
    }));
  };

  const removeBlock = (index) => {
    setDraft((d) => ({ ...d, blocks: d.blocks.filter((_, i) => i !== index) }));
  };

  const todaySchedule = schedule?.days.find((d) => d.isToday);

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Dedicated module · separate from walking</div>
          <h1 className="page-title">Treadmill</h1>
          <p className="lede">
            Indoor incline work is tracked on its own dashboard. Those steps stay in your fitness history but
            are excluded from the 10,000-step walking goal.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => setRunnerOpen(true)}>
            <IconPlay size={14} /> Run session
          </Button>
          <Button size="sm" variant="primary" onClick={() => setLogOpen(true)}>
            <IconPlus size={14} /> Log session
          </Button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="stat-strip">
        <div className="stat-strip-item">
          <span className="eyebrow">This week</span>
          <div className="num stat-big">{fmtNum(schedule?.totals?.minutes ?? 0)}<span className="stat-unit">min</span></div>
          <div className="tiny dim">of {schedule?.progression?.weeklyPrescribedMinutes ?? 150} prescribed</div>
        </div>
        <div className="stat-strip-item">
          <span className="eyebrow">Sessions</span>
          <div className="num stat-big">{fmtNum(totals.sessions)}</div>
          <div className="tiny dim">last 90 days</div>
        </div>
        <div className="stat-strip-item">
          <span className="eyebrow">Distance</span>
          <div className="num stat-big">{totals.distance.toFixed(1)}<span className="stat-unit">km</span></div>
          <div className="tiny dim">incline walking</div>
        </div>
        <div className="stat-strip-item">
          <span className="eyebrow">Today</span>
          <div className="num stat-big">{todaySchedule?.completedMinutes ?? 0}<span className="stat-unit">min</span></div>
          <div className="tiny dim">{todaySchedule?.treadmillMin ? `plan ${todaySchedule.treadmillMin} min` : 'no planned walk'}</div>
        </div>
        <div className="stat-strip-item stat-strip-status">
          <span className="eyebrow">Evidence</span>
          <StatusBadge status={sessions.some((s) => s.evidence === 'verified_device') ? 'verified_device' : sessions.length ? 'logged_user' : 'not_recorded'} />
          <div className="tiny dim" style={{ marginTop: 5 }}>
            {sessions.some((s) => s.health_workout_id) ? 'Apple Watch link found' : 'Manual entries only'}
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'planner', label: 'Session planner' },
          { id: 'schedule', label: 'Weekly plan' },
          { id: 'history', label: 'History', count: sessions.length },
          { id: 'progression', label: 'Progression' },
        ]}
      />

      {tab === 'planner' && draft && (
        <div className="treadmill-planner">
          <Panel
            title={<><IconTreadmill size={16} /> Preset & blocks</>}
            sub="Every value is editable. The preset is a starting point, not a prescription."
            action={
              <select
                className="select"
                value={selectedId || ''}
                onChange={(e) => setSelectedId(Number(e.target.value))}
                style={{ width: 224, height: 32 }}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' · default' : ''}</option>
                ))}
              </select>
            }
          >
            <div className="planner-name-row">
              <Field label="Preset name" style={{ flex: 1 }}>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <div className="planner-summary">
                <div>
                  <span className="eyebrow">Total</span>
                  <div className="num">{totalMinutes}<span className="stat-unit">min</span></div>
                </div>
                <div>
                  <span className="eyebrow">Avg incline</span>
                  <div className="num">{avgIncline.toFixed(1)}<span className="stat-unit">%</span></div>
                </div>
                <div>
                  <span className="eyebrow">Est. distance</span>
                  <div className="num">{estimatedDistance.toFixed(2)}<span className="stat-unit">km</span></div>
                </div>
              </div>
            </div>

            <div className="planner-blocks">
              {draft.blocks.map((block, i) => (
                <div className="planner-block" key={block.id} data-tone={BLOCK_TONES[block.color] || 'main'}>
                  <div className="planner-block-head">
                    <span className="planner-block-marker" />
                    <input
                      className="planner-block-title"
                      value={block.label}
                      onChange={(e) => updateBlock(i, 'label', e.target.value)}
                      aria-label="Block label"
                    />
                    <input
                      className="input planner-min"
                      type="number"
                      min={1}
                      max={120}
                      value={block.minutes}
                      onChange={(e) => updateBlock(i, 'minutes', Number(e.target.value))}
                      aria-label="Minutes"
                    />
                    <span className="tiny dim">min</span>
                    <button className="icon-btn" onClick={() => removeBlock(i)} aria-label="Remove block" disabled={draft.blocks.length <= 1}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                  <div className="planner-range-grid">
                    <div className="range-pair">
                      <span className="tiny dim">Speed</span>
                      <input className="input" type="number" step="0.1" value={block.speedMin} onChange={(e) => updateBlock(i, 'speedMin', Number(e.target.value))} aria-label="Min speed" />
                      <span className="tiny dim">–</span>
                      <input className="input" type="number" step="0.1" value={block.speedMax} onChange={(e) => updateBlock(i, 'speedMax', Number(e.target.value))} aria-label="Max speed" />
                      <span className="tiny dim">km/h</span>
                    </div>
                    <div className="range-pair">
                      <span className="tiny dim">Incline</span>
                      <input className="input" type="number" step="0.5" value={block.inclineMin} onChange={(e) => updateBlock(i, 'inclineMin', Number(e.target.value))} aria-label="Min incline" />
                      <span className="tiny dim">–</span>
                      <input className="input" type="number" step="0.5" value={block.inclineMax} onChange={(e) => updateBlock(i, 'inclineMax', Number(e.target.value))} aria-label="Max incline" />
                      <span className="tiny dim">%</span>
                    </div>
                  </div>
                  {block.note && <div className="tiny dim planner-block-note">{block.note}</div>}
                </div>
              ))}
            </div>

            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" onClick={addBlock}><IconPlus size={14} /> Add block</Button>
              <span className="spacer" />
              <Button size="sm" variant="ghost" onClick={saveAsNew} disabled={saving}>Save as new</Button>
              <Button size="sm" variant="primary" onClick={savePreset} disabled={saving}>Save changes</Button>
            </div>
          </Panel>

          <div className="stack">
            <Panel
              title="Session timeline"
              sub={`${timeline.blocks.length} phases · ${totalMinutes} minutes`}
              action={<span className="chip">Live preview</span>}
            >
              <div className="session-timeline" role="img" aria-label="Session timeline">
                {timeline.blocks.map((b) => (
                  <div
                    key={b.id}
                    className="session-block"
                    data-tone={BLOCK_TONES[b.color] || 'main'}
                    style={{ flex: Math.max(0.4, b.minutes) }}
                    title={`${b.label}: ${b.minutes} min · ${b.speedMin}–${b.speedMax} km/h · ${b.inclineMin}–${b.inclineMax}%`}
                  >
                    <span className="sb-label">{b.label}</span>
                    <span className="sb-meta">{b.minutes}m · {b.inclineMin}–{b.inclineMax}%</span>
                  </div>
                ))}
              </div>

              <div className="timeline-axis">
                {timeline.blocks.map((b, i) => (
                  <div key={`ax-${b.id}`} className="timeline-axis-item" style={{ flex: Math.max(0.4, b.minutes) }}>
                    <span className="tiny dim">{b.startMin}′</span>
                    {i === timeline.blocks.length - 1 && <span className="tiny dim">{b.endMin}′</span>}
                  </div>
                ))}
              </div>

              <div className="phase-detail-grid">
                {timeline.blocks.map((b) => (
                  <div className="phase-detail" key={`detail-${b.id}`}>
                    <div className="row" style={{ gap: 7 }}>
                      <span className={`phase-dot ${BLOCK_TONES[b.color] || 'main'}`} />
                      <span className="small" style={{ fontWeight: 600 }}>{b.label}</span>
                      <span className="tiny dim" style={{ marginLeft: 'auto' }}>{b.minutes} min</span>
                    </div>
                    <div className="phase-detail-meta">
                      <span>{((Number(b.speedMin) + Number(b.speedMax)) / 2).toFixed(1)} km/h</span>
                      <span>{((Number(b.inclineMin) + Number(b.inclineMax)) / 2).toFixed(1)}% incline</span>
                    </div>
                    {b.note && <div className="tiny dim" style={{ marginTop: 6, lineHeight: 1.45 }}>{b.note}</div>}
                  </div>
                ))}
              </div>

              <div className="row" style={{ marginTop: 16, gap: 8 }}>
                <Button size="sm" onClick={() => setRunnerOpen(true)}><IconPlay size={14} /> Start guided session</Button>
                <Button size="sm" variant="ghost" onClick={() => setLogOpen(true)}>Log without timer</Button>
              </div>
            </Panel>

            <Panel title="What this does — and doesn't do" sub="A note on incline walking">
              <div className="stack" style={{ gap: 10 }}>
                <p className="small muted">
                  Incline walking raises heart rate and energy expenditure at a walking pace. That makes it a useful
                  low-impact cardio tool. It does not create a special “fat-burning zone”, and no incline percentage
                  magically targets abdominal fat.
                </p>
                <p className="small muted">
                  Fat loss comes from a sustained calorie deficit with enough protein and resistance training to keep
                  muscle. The treadmill is one lever, not the lever.
                </p>
                <Note tone="warn" icon={<IconAlert size={15} />}>
                  If a session is missed, tomorrow's plan does not change. More incline is not a punishment.
                </Note>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="stack">
          <Panel title="Weekly cardio schedule" sub="Prescribed ranges, not a debt ledger">
            <div className="schedule-list">
              {schedule?.days.map((day) => (
                <div className={`schedule-row ${day.isToday ? 'schedule-today' : ''}`} key={day.day}>
                  <div className="schedule-day">
                    <span className="schedule-day-name">{day.day.slice(0, 3)}</span>
                    <span className="tiny dim">{fmtDate(day.date)}</span>
                  </div>
                  <div className="schedule-split">
                    <span className="small" style={{ fontWeight: 600 }}>{day.split}</span>
                    <span className="tiny dim">{day.mode}</span>
                  </div>
                  <div className="schedule-intent tiny dim">{day.intent}</div>
                  <div className="schedule-minutes">
                    <span className="num">{day.minutes ?? day.treadmillMin}</span>
                    <span className="tiny dim">min</span>
                  </div>
                  <div className="schedule-progress">
                    <ProgressBar value={day.completedMinutes} max={Math.max(1, day.minMinutes || 1)} />
                    <span className="tiny dim">
                      {day.sessions.length ? `${day.completedMinutes} min logged` : day.optional ? 'optional' : 'not logged'}
                    </span>
                  </div>
                  {day.date > (schedule?.today || '') ? (
                    <span className="badge" data-tone="empty">Planned</span>
                  ) : (
                    <StatusBadge status={day.met ? 'logged_user' : 'not_recorded'} short />
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <div className="two-up">
            <Panel title="Progression" sub="Built from completed weeks" action={<span className="chip">{schedule?.progression?.stage}</span>}>
              <p className="small muted" style={{ marginBottom: 14 }}>{schedule?.progression?.suggestion}</p>
              <BarChart
                data={(schedule?.progression?.weeks || []).map((w) => ({
                  label: w.weekStart,
                  shortLabel: fmtDate(w.weekStart),
                  value: w.minutes,
                  tooltip: `Week of ${fmtDate(w.weekStart)}`,
                }))}
                goal={schedule?.progression?.weeklyPrescribedMinutes}
                height={110}
                format={(v) => `${fmtNum(v)} min`}
                label="Weekly treadmill minutes"
              />
              <div className="tiny dim" style={{ marginTop: 8 }}>
                Dashed goal at {schedule?.progression?.weeklyPrescribedMinutes} min/week
              </div>
            </Panel>
            <Panel title="Progression rules" sub="Guardrails built into the engine">
              <div className="stack" style={{ gap: 10 }}>
                {schedule?.progression?.rules?.map((rule) => (
                  <div className="row" key={rule} style={{ alignItems: 'flex-start', gap: 8 }}>
                    <IconCheck size={14} style={{ color: 'var(--lime)', flexShrink: 0, marginTop: 3 }} />
                    <span className="small muted">{rule}</span>
                  </div>
                ))}
                <Note tone="info" icon={<IconInfo size={15} />}>
                  Duration increases only when sleep, joints and strength are stable. The engine looks at completed
                  weeks — never at the calendar alone.
                </Note>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <Panel
          title="Treadmill history"
          sub={`${sessions.length} sessions · ${totals.minutes} total minutes`}
          action={<Button size="sm" variant="ghost" onClick={load}><IconRefreshCw size={14} /> Refresh</Button>}
          flush
        >
          {sessions.length === 0 ? (
            <Empty icon={<IconTreadmill size={20} />} title="No treadmill sessions yet">
              Log your first incline walk, or import it automatically from Apple Health.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Duration</th>
                    <th>Speed</th>
                    <th>Incline</th>
                    <th>Distance</th>
                    <th>HR</th>
                    <th>Evidence</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{fmtDate(s.date)}</span>
                        <span className="tiny dim" style={{ display: 'block' }}>
                          {s.health_workout_id ? 'HealthKit' : 'Manual'}
                        </span>
                      </td>
                      <td className="mono dim">{fmtTime(s.start_time)}</td>
                      <td className="mono">{s.duration_min ? `${Math.round(s.duration_min)}m` : '—'}</td>
                      <td className="mono">{s.speed_kmh ?? '—'}</td>
                      <td className="mono">{s.incline_pct != null ? `${s.incline_pct}%` : '—'}</td>
                      <td className="mono">{s.distance_km != null ? `${s.distance_km} km` : '—'}</td>
                      <td className="mono">{s.avg_hr ?? '—'}</td>
                      <td>
                        <StatusBadge status={s.evidence} short />
                        {s.console_photo_id && (
                          <span className="tiny dim" style={{ display: 'block', marginTop: 2 }}>
                            console photo
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                          <button className="icon-btn" onClick={() => setDetailSession(s)} aria-label="Session details">
                            <IconInfo size={15} />
                          </button>
                          <button className="icon-btn" onClick={() => setConsoleSession(s)} aria-label="Console photo">
                            <IconCamera size={15} />
                          </button>
                          <button className="icon-btn" onClick={() => setEditSession(s)} aria-label="Edit session">
                            <IconEdit size={14} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label="Delete session"
                            onClick={async () => {
                              if (!confirm('Delete this treadmill session? Step attribution will be recalculated.')) return;
                              try {
                                await api.del(`/treadmill/sessions/${s.id}`);
                                toast('Session deleted', 'success');
                                load();
                              } catch (err) {
                                toast(err.message, 'error');
                              }
                            }}
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'progression' && (
        <div className="stack">
          <div className="two-up">
            <Panel title="Weekly volume" sub="Last 8 weeks">
              <BarChart
                data={weekly.map((w) => ({
                  label: w.start,
                  shortLabel: fmtDate(w.start),
                  value: w.minutes,
                  tooltip: `Week of ${fmtDate(w.start)}`,
                }))}
                goal={150}
                height={140}
                format={(v) => `${v} min`}
                label="Weekly treadmill volume"
              />
              <div className="tiny dim" style={{ marginTop: 8 }}>Target band: 150–170 min/week</div>
            </Panel>
            <Panel title="Pace & incline trend" sub="Average per session">
              {sessions.length >= 2 ? (
                <div className="progression-stats">
                  <div className="progression-stat">
                    <span className="eyebrow">Avg duration</span>
                    <div className="num">{Math.round(sessions.reduce((a, s) => a + (s.duration_min || 0), 0) / sessions.length)}<span className="stat-unit">min</span></div>
                  </div>
                  <div className="progression-stat">
                    <span className="eyebrow">Avg speed</span>
                    <div className="num">{(sessions.reduce((a, s) => a + (s.speed_kmh || 0), 0) / sessions.filter((s) => s.speed_kmh).length || 0).toFixed(1)}<span className="stat-unit">km/h</span></div>
                  </div>
                  <div className="progression-stat">
                    <span className="eyebrow">Avg incline</span>
                    <div className="num">{(sessions.reduce((a, s) => a + (s.incline_pct || 0), 0) / sessions.filter((s) => s.incline_pct != null).length || 0).toFixed(1)}<span className="stat-unit">%</span></div>
                  </div>
                  <div className="progression-stat">
                    <span className="eyebrow">Total distance</span>
                    <div className="num">{totals.distance.toFixed(1)}<span className="stat-unit">km</span></div>
                  </div>
                </div>
              ) : (
                <Empty title="Not enough sessions">Log at least two sessions to see trends.</Empty>
              )}
              <div style={{ marginTop: 18 }}>
                <HrZones avgHr={sessions.find((s) => s.avg_hr)?.avg_hr} maxHr={sessions.find((s) => s.max_hr)?.max_hr} />
              </div>
            </Panel>
          </div>

          <Panel title="Session split" sub="Warm-up · main · cooldown consistency">
            <div className="stack" style={{ gap: 10 }}>
              {sessions.slice(0, 8).map((s) => (
                <div key={s.id} className="row" style={{ gap: 12 }}>
                  <span className="tiny dim" style={{ width: 55 }}>{fmtDate(s.date)}</span>
                  <div style={{ flex: 1 }}>
                    <div className="session-timeline" style={{ height: 28 }}>
                      <div className="session-block" data-tone="warmup" style={{ flex: 5 }}>
                        <span className="sb-meta">5m</span>
                      </div>
                      <div className="session-block" data-tone="main" style={{ flex: Math.max(8, (s.duration_min || 20) - 10) }}>
                        <span className="sb-meta">{Math.max(0, (s.duration_min || 20) - 10)}m</span>
                      </div>
                      <div className="session-block" data-tone="cooldown" style={{ flex: 5 }}>
                        <span className="sb-meta">5m</span>
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={s.evidence} short />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <TreadmillModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onSaved={load}
        presets={presets}
        date={bootstrap?.today}
      />

      <RunnerModal
        open={runnerOpen}
        onClose={() => setRunnerOpen(false)}
        timeline={timeline}
        preset={draft}
        onSaved={load}
      />

      <ConsolePhotoModal
        session={consoleSession}
        onClose={() => setConsoleSession(null)}
        onSaved={load}
      />

      <TreadmillModal
        open={!!editSession}
        onClose={() => setEditSession(null)}
        onSaved={load}
        presets={presets}
        initial={editSession}
        title="Edit treadmill session"
      />

      <SessionDetailModal session={detailSession} onClose={() => setDetailSession(null)} />
    </div>
  );
}

/* ================================================================== */
/* Guided runner                                                      */
/* ================================================================== */

function RunnerModal({ open, onClose, timeline, preset, onSaved }) {
  const { toast, user } = useApp();
  const userTimezone = user?.timezone || 'Asia/Kolkata';
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef(null);

  const total = timeline.totalMinutes;

  useEffect(() => {
    if (!open) {
      setElapsed(0);
      setPaused(false);
      setFinished(false);
      return undefined;
    }
    return () => clearInterval(timerRef.current);
  }, [open]);

  useEffect(() => {
    if (!open || paused || finished) {
      clearInterval(timerRef.current);
      return undefined;
    }
    timerRef.current = setInterval(() => {
      setElapsed((e) => {
        if (e + 1 >= total * 60) {
          clearInterval(timerRef.current);
          setFinished(true);
          return total * 60;
        }
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [open, paused, finished, total]);

  const phase = timeline.blocks.find((b) => elapsed / 60 >= b.startMin && elapsed / 60 < b.endMin) ||
    timeline.blocks[timeline.blocks.length - 1] || null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const pct = total ? (elapsed / 60 / total) * 100 : 0;

  const save = async () => {
    setSaving(true);
    try {
      const now = new Date();
      const start = new Date(now.getTime() - elapsed * 1000);
      const speed = timeline.blocks.length
        ? timeline.blocks.reduce((s, b) => s + ((b.speedMin + b.speedMax) / 2) * b.minutes, 0) / total
        : null;
      const incline = timeline.blocks.length
        ? timeline.blocks.reduce((s, b) => s + ((b.inclineMin + b.inclineMax) / 2) * b.minutes, 0) / total
        : null;
      await api.post('/treadmill/sessions', {
        date: dateKeyInZone(now, userTimezone),
        presetId: preset?.id || null,
        title: preset?.name || 'Treadmill session',
        durationMin: Math.round((elapsed / 60) * 10) / 10,
        speedKmh: Math.round(speed * 10) / 10,
        inclinePct: Math.round(incline * 10) / 10,
        distanceKm: Math.round(((speed * elapsed) / 3600) * 100) / 100,
        startTime: start.toISOString(),
        endTime: now.toISOString(),
        notes: 'Completed in the guided session runner.',
      });
      toast('Session saved', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Guided session" sub={preset?.name || 'Treadmill session'} wide>
      <div className="runner">
        <div className="runner-ring">
          <svg viewBox="0 0 200 200" width="220" height="220">
            <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
            <circle
              cx="100"
              cy="100"
              r="88"
              fill="none"
              stroke="url(#runnerGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 88}
              strokeDashoffset={2 * Math.PI * 88 * (1 - pct / 100)}
              transform="rotate(-90 100 100)"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
            <defs>
              <linearGradient id="runnerGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--lime)" />
                <stop offset="100%" stopColor="var(--teal)" />
              </linearGradient>
            </defs>
          </svg>
          <div className="runner-center">
            <span className="eyebrow">{phase?.label || 'Complete'}</span>
            <span className="runner-time num">{String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}</span>
            <span className="tiny dim">{Math.max(0, Math.round(total - mins))} min left</span>
          </div>
        </div>

        <div className="runner-targets">
          <div className="runner-target">
            <span className="eyebrow">Target incline</span>
            <div className="num">{phase ? `${phase.inclineMin}–${phase.inclineMax}%` : '—'}</div>
          </div>
          <div className="runner-target">
            <span className="eyebrow">Target speed</span>
            <div className="num">{phase ? `${phase.speedMin}–${phase.speedMax}` : '—'}<span className="stat-unit">km/h</span></div>
          </div>
          <div className="runner-target">
            <span className="eyebrow">Elapsed</span>
            <div className="num">{Math.round((elapsed / 60) * 10) / 10}<span className="stat-unit">min</span></div>
          </div>
        </div>

        <div className="session-timeline" style={{ marginTop: 18 }}>
          {timeline.blocks.map((b) => {
            const isActive = phase && phase.id === b.id;
            return (
              <div
                key={b.id}
                className="session-block"
                data-tone={b.color}
                style={{ flex: Math.max(0.4, b.minutes), opacity: isActive || !phase ? 1 : 0.45 }}
              >
                <span className="sb-label">{b.label}</span>
                <span className="sb-meta">{b.minutes}m</span>
              </div>
            );
          })}
        </div>

        <div className="runner-actions">
          <Button variant="ghost" onClick={() => setElapsed(0)} disabled={saving}>
            <IconRefreshCw size={14} /> Reset
          </Button>
          {!finished ? (
            <Button variant="primary" onClick={() => setPaused((p) => !p)}>
              {paused ? <><IconPlay size={14} /> Resume</> : <><IconPause size={14} /> Pause</>}
            </Button>
          ) : (
            <Button variant="primary" onClick={save} disabled={saving}>
              <IconCheck size={14} /> Save session
            </Button>
          )}
          {!finished && (
            <Button onClick={() => setFinished(true)} disabled={elapsed < 30}>
              Finish early
            </Button>
          )}
        </div>

        <p className="tiny dim" style={{ textAlign: 'center', marginTop: 12 }}>
          Timer is a convenience. It does not verify that the session happened — that still requires your log or a
          HealthKit record.
        </p>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Console photo OCR                                                  */
/* ================================================================== */

function ConsolePhotoModal({ session, onClose, onSaved }) {
  const { toast } = useApp();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (session) {
      setFile(null);
      setResult(null);
      const extracted = session.console_extracted;
      setValues({
        speedKmh: extracted?.extracted?.speedKmh ?? session.speed_kmh ?? '',
        inclinePct: extracted?.extracted?.inclinePct ?? session.incline_pct ?? '',
        durationMin: extracted?.extracted?.durationMin ?? session.duration_min ?? '',
        distanceKm: extracted?.extracted?.distanceKm ?? session.distance_km ?? '',
      });
      if (extracted) setResult(extracted);
    }
  }, [session]);

  if (!session) return null;

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const res = await api.upload(`/treadmill/sessions/${session.id}/console`, fd);
      setResult(res);
      setValues({
        speedKmh: res.extracted?.speedKmh ?? values.speedKmh,
        inclinePct: res.extracted?.inclinePct ?? values.inclinePct,
        durationMin: res.extracted?.durationMin ?? values.durationMin,
        distanceKm: res.extracted?.distanceKm ?? values.distanceKm,
      });
      if (!res.ocrAvailable) toast('OCR helper not available — enter values manually', 'error');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      await api.post(`/treadmill/sessions/${session.id}/console/confirm`, values);
      toast('Console values confirmed', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Treadmill console photo"
      sub={`${fmtDate(session.date)} · ${fmtMinutes(session.duration_min)} logged`}
      wide
    >
      <div className="stack" style={{ gap: 14 }}>
        <Note tone="info" icon={<IconInfo size={15} />}>
          A console photo corroborates the numbers on the display. It cannot prove who was on the machine, and it is
          never treated as conclusive proof that you completed the session.
        </Note>

        {(result?.photo || session.console_photo_id) && (
          <div className="console-preview">
            <PhotoImage photoId={result?.photo?.id || session.console_photo_id} alt="Treadmill console" />
          </div>
        )}

        <div className="console-upload">
          <input
            id="console-file"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ display: 'none' }}
          />
          <label htmlFor="console-file" className="console-drop">
            <IconCamera size={24} />
            <span>{file ? file.name : 'Choose a console photo'}</span>
            <span className="tiny dim">JPG, PNG, WEBP or HEIC · up to 12 MB</span>
          </label>
          <Button onClick={upload} disabled={!file || busy} variant="primary">
            {busy ? <span className="spinner" /> : 'Extract readings'}
          </Button>
        </div>

        {result && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row-between">
              <div>
                <div className="small" style={{ fontWeight: 600 }}>Extracted readings</div>
                <div className="tiny dim">
                  {result.ocrAvailable === false
                    ? 'OCR unavailable on this machine — enter values manually below.'
                    : `${result.foundCount ?? 0} readings found · confidence ${result.confidence ?? 'low'}`}
                </div>
              </div>
              {result.hasDiscrepancy && <StatusBadge status="needs_review" />}
            </div>

            <div className="form-grid">
              <Field label="Speed (km/h)">
                <input className="input" type="number" step="0.1" value={values.speedKmh} onChange={(e) => setValues({ ...values, speedKmh: e.target.value })} />
              </Field>
              <Field label="Incline (%)">
                <input className="input" type="number" step="0.5" value={values.inclinePct} onChange={(e) => setValues({ ...values, inclinePct: e.target.value })} />
              </Field>
              <Field label="Duration (min)">
                <input className="input" type="number" step="0.1" value={values.durationMin} onChange={(e) => setValues({ ...values, durationMin: e.target.value })} />
              </Field>
              <Field label="Distance (km)">
                <input className="input" type="number" step="0.01" value={values.distanceKm} onChange={(e) => setValues({ ...values, distanceKm: e.target.value })} />
              </Field>
            </div>

            {result.comparisons?.length > 0 && (
              <div className="comparison-list">
                {result.comparisons.map((c) => (
                  <div className="comparison-row" key={c.field} data-status={c.status}>
                    <span className="small">{c.label}</span>
                    <span className="mono tiny">photo {c.extracted}</span>
                    <span className="mono tiny dim">log {c.logged ?? '—'}</span>
                    <span className={`tiny ${c.status === 'discrepancy' ? 'delta-down' : 'dim'}`}>{c.message}</span>
                  </div>
                ))}
              </div>
            )}

            {result.recognisedLines?.length > 0 && (
              <details className="ocr-lines">
                <summary className="tiny dim">Recognised text ({result.recognisedLines.length} lines)</summary>
                <pre>{result.recognisedLines.join('\n')}</pre>
              </details>
            )}
          </div>
        )}

        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={confirming}>
            Confirm values
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SessionDetailModal({ session, onClose }) {
  if (!session) return null;
  const rows = [
    ['Date', fmtDate(session.date, { year: true })],
    ['Duration', session.duration_min != null ? fmtMinutes(session.duration_min) : '—'],
    ['Avg speed', session.speed_kmh != null ? `${session.speed_kmh} km/h` : '—'],
    ['Incline', session.incline_pct != null ? `${session.incline_pct}%` : '—'],
    ['Distance', session.distance_km != null ? `${session.distance_km} km` : '—'],
    ['Heart rate', session.avg_hr ? `${Math.round(session.avg_hr)} avg${session.max_hr ? ` · ${Math.round(session.max_hr)} peak` : ''}` : '—'],
    ['Active calories', session.active_calories != null ? `${Math.round(session.active_calories)} kcal — estimate` : '—'],
    ['Difficulty', session.difficulty || '—'],
    ['Recovery after', session.recovery_status || '—'],
    ['Source', session.health_workout_id ? 'Apple Health indoor walk' : 'Manual entry'],
    ['HealthKit sync', session.health_imported_at ? fmtDateTime(session.health_imported_at) : 'Not linked'],
    ['Console photo', session.console_photo_id ? (session.console_confirmed ? 'Confirmed' : 'Awaiting confirmation') : 'None'],
  ];
  return (
    <Modal open={!!session} onClose={onClose} title="Treadmill session" sub={session.title}>
      <div className="session-detail-list">
        {rows.map(([label, value]) => (
          <div className="session-detail-row" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14, gap: 8 }}>
        <StatusBadge status={session.evidence} />
        {session.health_workout_id && <span className="chip">Linked HealthKit workout</span>}
      </div>
      {session.notes && <p className="small muted" style={{ marginTop: 12 }}>{session.notes}</p>}
      <p className="tiny dim" style={{ marginTop: 12 }}>
        Incline and belt speed are not available from HealthKit. Unless a treadmill integration supplied them, they are
        manual values and are labelled as such.
      </p>
    </Modal>
  );
}

function shiftDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function hostDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
