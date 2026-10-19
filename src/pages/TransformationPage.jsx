import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Panel, Button, StatusBadge, ProgressBar, Metric, Note, Ring, Segmented, Empty } from '../components/ui.jsx';
import { LineChart } from '../components/charts.jsx';
import { WeighInModal } from '../components/forms.jsx';
import { PhotoImage } from '../components/PhotoImage.jsx';
import {
  IconArrowRight,
  IconCamera,
  IconHeart,
  IconInfo,
  IconPlus,
  IconScale,
  IconShield,
  IconTrendingDown,
  IconTreadmill,
  IconWatch,
} from '../components/icons.jsx';
import { fmtNum, fmtKg, fmtPct, fmtDate, fmtMinutes, signed, daysBetween } from '../lib/format.js';

const METRIC = 'var(--lime)';

export default function TransformationPage() {
  const { toast, dataVersion } = useApp();
  const [data, setData] = useState(null);
  const [range, setRange] = useState('all');
  const [weighOpen, setWeighOpen] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setData(await api.get('/transformation'));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, [dataVersion]);

  if (error) {
    return (
      <div className="page">
        <Panel><Empty title="Could not load transformation data">{error}</Empty></Panel>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <div className="panel" style={{ height: 400, display: 'grid', placeItems: 'center' }}><span className="spinner" /></div>
      </div>
    );
  }

  const { series, first, latest, latestBodyFat, projection, strength, weeks, photos, progress, coach, adherence, treadmill, steps, recovery, goal, profile, health, startDate, checkpoint, today } = data;

  const filteredSeries =
    range === 'all' ? series : series.slice(-(range === '30' ? 30 : 90));

  const weightDelta = latest && first ? latest.weight_kg - first.weight_kg : null;
  const waistDelta = latest?.waist_cm != null && first?.waist_cm != null ? latest.waist_cm - first.waist_cm : null;
  const bodyFat = latestBodyFat?.body_fat_pct != null ? { value: latestBodyFat.body_fat_pct, source: latestBodyFat.body_fat_source, date: latestBodyFat.date } : null;
  const currentWeek = weeks.find((w) => w.isCurrent);
  const completedWeeks = weeks.filter((w) => !w.isFuture && w.end <= today);
  const adherentWeeks = completedWeeks.filter((w) => (w.calories ?? 0) >= 80).length;
  const photoByWeek = new Map();
  for (const p of photos) {
    if (!photoByWeek.has(p.week_start)) photoByWeek.set(p.week_start, {});
    photoByWeek.get(p.week_start)[p.angle] = p;
  }
  const photoWeeks = [...photoByWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const latestPhotoWeek = photoWeeks[0]?.[0];
  const previousPhotoWeek = photoWeeks[1]?.[0];

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">October 19 → December 1 · checkpoint, not a deadline</div>
          <h1 className="page-title">Transformation</h1>
          <p className="lede">
            Weight, waist, adherence and strength in one honest view. Body fat only appears when it was measured or
            when it is explicitly labelled as an estimate.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => setWeighOpen(true)}><IconPlus size={14} /> Weigh in</Button>
          <Link to="/progress" className="btn btn-sm"><IconCamera size={14} /> Progress photos</Link>
        </div>
      </div>

      {/* Hero */}
      <section className="hero-panel transform-hero">
        <div className="transform-hero-main">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="eyebrow">Current weight</span>
            <StatusBadge status={latest ? 'logged_user' : 'not_recorded'} short />
          </div>
          <div className="transform-weight-row">
            {latest ? (
              <div className="transform-weight">
                <span className="num">{fmtKg(latest.weight_kg)}</span>
                <span className="unit">kg</span>
              </div>
            ) : (
              <div className="today-weight-empty">No weigh-in yet</div>
            )}
            <div className="transform-deltas">
              <div>
                <span className="eyebrow">Since start</span>
                <div className={`num transform-delta ${weightDelta != null && weightDelta < 0 ? 'delta-up' : ''}`}>
                  {weightDelta != null ? signed(weightDelta, 1, ' kg') : '—'}
                </div>
              </div>
              <div>
                <span className="eyebrow">7-day avg</span>
                <div className="num transform-delta">{fmtKg(projection.currentAverage ?? series.at(-1)?.rolling)}</div>
              </div>
              <div>
                <span className="eyebrow">Weekly rate</span>
                <div className="num transform-delta">{projection.weeklyRate != null ? signed(projection.weeklyRate, 2, ' kg') : '—'}</div>
              </div>
            </div>
          </div>

          <div className="transform-target-line">
            <span className="tiny dim">{fmtDate(startDate)}</span>
            <div className="transform-target-track">
              <div
                className="transform-target-fill"
                style={{ width: `${progress.pct}%` }}
              />
              <span className="transform-target-pin" style={{ left: `${progress.pct}%` }} />
            </div>
            <span className="tiny dim">{fmtDate(checkpoint)}</span>
          </div>
          <div className="row-between" style={{ marginTop: 7 }}>
            <span className="tiny dim">Day {progress.elapsedDays + 1} of {progress.totalDays}</span>
            <span className="tiny" style={{ color: 'var(--lime)', fontWeight: 600 }}>{progress.remainingDays} days remaining</span>
          </div>
        </div>

        <div className="transform-hero-side">
          <div className="projection-card">
            <div className="row" style={{ gap: 6, marginBottom: 4 }}>
              <IconTrendingDown size={15} style={{ color: 'var(--lime)' }} />
              <span className="eyebrow">December 1 range</span>
            </div>
            {projection.status === 'ok' ? (
              <>
                <div className="num projection-number">
                  {fmtKg(projection.low)}<span className="projection-dash">–</span>{fmtKg(projection.high)}
                  <span className="unit">kg</span>
                </div>
                <div className="projection-conf">
                  {projection.confidence} confidence · {projection.sampleDays} days of data
                </div>
                <p className="tiny dim" style={{ marginTop: 8, lineHeight: 1.5 }}>
                  {projection.note}
                </p>
              </>
            ) : (
              <div className="small muted">{projection.message}</div>
            )}
          </div>
        </div>
      </section>

      {/* Key metrics */}
      <div className="transform-metrics">
        <div className="transform-metric">
          <span className="eyebrow">Waist</span>
          <div className="num transform-metric-value">{latest?.waist_cm != null ? `${latest.waist_cm}` : '—'}<span className="stat-unit">cm</span></div>
          <div className="tiny dim">
            {waistDelta != null ? `${signed(waistDelta, 1, ' cm')} since start` : 'Not measured'}
          </div>
        </div>
        <div className="transform-metric">
          <span className="eyebrow">Body fat</span>
          <div className="num transform-metric-value">
            {bodyFat ? `${bodyFat.value}` : '—'}<span className="stat-unit">{bodyFat ? '%' : ''}</span>
          </div>
          <div className="tiny dim">
            {bodyFat ? (
              <span className="row" style={{ gap: 6 }}>
                {bodyFat.source === 'measured_scale' || bodyFat.source === 'dexa' ? 'Measured' : 'Estimated'}
                <span className="dim">{fmtDate(bodyFat.date)}</span>
                <StatusBadge status={bodyFat.source === 'measured_scale' || bodyFat.source === 'dexa' ? 'verified_device' : 'ai_estimated'} short />
              </span>
            ) : 'No measurement recorded'}
          </div>
        </div>
        <div className="transform-metric">
          <span className="eyebrow">Strength retention</span>
          <div className="num transform-metric-value">{strength.status === 'ok' ? strength.score : '—'}<span className="stat-unit">{strength.status === 'ok' ? '/100' : ''}</span></div>
          <div className="tiny dim">{strength.status === 'ok' ? strength.label : 'Building baseline'}</div>
        </div>
        <div className="transform-metric">
          <span className="eyebrow">Protein consistency</span>
          <div className="num transform-metric-value">{adherence.proteinConsistencyPct ?? '—'}<span className="stat-unit">%</span></div>
          <div className="tiny dim">{adherence.proteinAdherentDays}/{adherence.loggedDays} logged days</div>
        </div>
        <div className="transform-metric">
          <span className="eyebrow">Calorie adherence</span>
          <div className="num transform-metric-value">{adherence.calorieAdherencePct ?? '—'}<span className="stat-unit">%</span></div>
          <div className="tiny dim">{adherence.calorieAdherentDays}/{adherence.loggedDays} logged days</div>
        </div>
        <div className="transform-metric">
          <span className="eyebrow">Treadmill</span>
          <div className="num transform-metric-value">{fmtNum(treadmill.minutes)}<span className="stat-unit">min</span></div>
          <div className="tiny dim">{treadmill.sessions} sessions this week</div>
        </div>
        <div className="transform-metric">
          <span className="eyebrow">Qualifying steps</span>
          <div className="num transform-metric-value">{fmtNum(steps?.qualifying_steps)}</div>
          <div className="tiny dim">{steps ? `±${steps.uncertainty_pct}% · ${steps.method.replaceAll('_', ' ')}` : 'pending sync'}</div>
        </div>
        <div className="transform-metric">
          <span className="eyebrow">Sleep</span>
          <div className="num transform-metric-value">{recovery.avgSleep ?? '—'}<span className="stat-unit">h</span></div>
          <div className="tiny dim">Readiness {recovery.avgReadiness ?? '—'}/5{recovery.avgReadiness != null ? ` · ${recovery.trend}` : ''}</div>
        </div>
      </div>

      {/* Weight + coach */}
      <div className="transform-main-grid">
        <Panel
          title="Weight trajectory"
          sub="Daily readings, 7-day rolling average and a projected range"
          action={
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: '30', label: '30d' },
                { value: '90', label: '90d' },
                { value: 'all', label: 'All' },
              ]}
              label="Chart range"
            />
          }
        >
          <WeightProjectionChart
            series={filteredSeries}
            projection={projection}
            checkpoint={checkpoint}
            today={today}
            startDate={startDate}
            goalWeight={goal?.target_weight_kg}
          />
          <div className="legend" style={{ marginTop: 14 }}>
            <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--lime)' }} />7-day average</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: 'rgba(255,255,255,0.3)' }} />Daily weigh-in</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--teal)', opacity: 0.55 }} />Projected range</span>
            {goal?.target_weight_kg && <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--violet)' }} />Target {goal.target_weight_kg} kg</span>}
          </div>
          {projection.status === 'ok' && (
            <div className="projection-note">
              <IconInfo size={14} />
              <span>
                The shaded band is the statistical uncertainty of a straight-line fit from your logged weights. It
                widens with noisy data. It is not a guarantee — and December 1 is a checkpoint, not a finish line.
              </span>
            </div>
          )}
        </Panel>

        <div className="stack">
          <Panel title="Coach read" sub="7-day average, waist, strength and intake">
            <div className="coach-mini" data-tone={coach.tone}>
              <div className="coach-mini-head">{coach.headline}</div>
              <p className="small muted" style={{ marginTop: 6 }}>{coach.recommendation}</p>
              {coach.waistNote && <p className="tiny dim" style={{ marginTop: 6 }}>{coach.waistNote}</p>}
              {coach.deadlineNote && <p className="tiny dim" style={{ marginTop: 8 }}>{coach.deadlineNote}</p>}
            </div>
            <div className="coach-flags">
              {coach.flags.slice(0, 4).map((flag) => (
                <span className="chip" key={flag}>{flag.replaceAll('_', ' ')}</span>
              ))}
            </div>
            <div className="guardrails">
              {coach.guardrails.map((g) => (
                <div key={g} className="guardrail"><IconShield size={12} /> {g}</div>
              ))}
            </div>
          </Panel>

          <Panel title="Weekly adherence" sub="Logged days only · gaps never count as zero">
            <div className="week-adherence">
              {weeks.filter((w) => !w.isFuture).slice(-8).map((w) => (
                <div className="week-adherence-row" key={w.week}>
                  <span className="tiny dim" style={{ width: 46 }}>W{w.week}</span>
                  <div style={{ flex: 1 }}>
                    <ProgressBar value={w.calories ?? 0} max={100} tone={(w.calories ?? 0) >= 80 ? '' : 'amber'} />
                  </div>
                  <span className="tiny mono" style={{ width: 34, textAlign: 'right' }}>{w.calories ?? '—'}%</span>
                  <span className="tiny dim" style={{ width: 54, textAlign: 'right' }}>{w.loggedDays} days</span>
                </div>
              ))}
            </div>
            <div className="tiny dim" style={{ marginTop: 12 }}>
              {completedWeeks.length
                ? `${adherentWeeks} of ${completedWeeks.length} completed weeks at ≥80% calorie adherence.`
                : 'No completed weeks yet — the current week is still in progress.'}
            </div>
          </Panel>
        </div>
      </div>

      {/* Mid grid: waist, recovery, photos */}
      <div className="transform-three">
        <Panel title="Waist circumference" sub="Measured at the navel, same time of day">
          <WaistChart series={series} />
        </Panel>

        <Panel title="Recovery trend" sub="Sleep hours and readiness">
          <RecoveryMini recovery={recovery} weeks={weeks} />
        </Panel>

        <Panel
          title="Progress photos"
          sub="Weekly front / side / back"
          action={<Link to="/progress" className="btn btn-sm btn-ghost">Open <IconArrowRight size={13} /></Link>}
        >
          <div className="photo-compare">
            {['front', 'side'].map((angle) => (
              <div className="photo-frame" key={angle}>
                {latestPhotoWeek && photoByWeek.get(latestPhotoWeek)?.[angle] ? (
                  <PhotoImage photoId={photoByWeek.get(latestPhotoWeek)[angle].photo_id} alt={`${angle} progress`} />
                ) : (
                  <div className="photo-empty"><IconCamera size={20} /><span>No {angle} photo</span></div>
                )}
                <span className="photo-label">{latestPhotoWeek ? fmtDate(latestPhotoWeek) : '—'} · {angle}</span>
              </div>
            ))}
          </div>
          <div className="tiny dim" style={{ marginTop: 10 }}>
            {latestPhotoWeek
              ? 'Private storage. AI does not estimate body fat from these photos.'
              : 'Photos are optional. Their absence does not mean progress is not happening.'}
          </div>
        </Panel>
      </div>

      {/* Timeline */}
      <Panel title="Milestone timeline" sub={`${weeks.length} weeks from start to checkpoint`}>
        <div className="milestone-strip scroll-x">
          {weeks.map((w) => (
            <div
              key={w.week}
              className={`milestone ${w.isCurrent ? 'milestone-current' : ''} ${w.isFuture ? 'milestone-future' : ''} ${!w.isFuture && !w.isCurrent ? 'milestone-done' : ''}`}
            >
              <div className="milestone-top">
                <span className="tiny dim">Week {w.week}</span>
                <span className="milestone-dot" />
              </div>
              <div className="milestone-date">{fmtDate(w.start)}</div>
              <div className="milestone-stats">
                {w.weightAvg != null && <span className="num">{w.weightAvg}<span className="stat-unit">kg</span></span>}
                {w.waist != null && <span className="tiny dim">{w.waist} cm</span>}
              </div>
              <div className="milestone-foot">
                {w.isFuture ? 'Upcoming' : w.isCurrent ? 'In progress' : `${w.loggedDays} days logged`}
              </div>
              {w.isCurrent && <div className="milestone-progress"><ProgressBar value={w.loggedDays} max={7} /></div>}
            </div>
          ))}
          <div className="milestone milestone-checkpoint">
            <div className="milestone-top">
              <span className="tiny" style={{ color: 'var(--lime)', fontWeight: 700 }}>CHECKPOINT</span>
              <IconHeart size={14} style={{ color: 'var(--lime)' }} />
            </div>
            <div className="milestone-date">{fmtDate(checkpoint, { year: true })}</div>
            <div className="milestone-stats">
              <span className="num">{projection.status === 'ok' ? `${fmtKg(projection.low)}–${fmtKg(projection.high)}` : '—'}<span className="stat-unit">kg</span></span>
            </div>
            <div className="milestone-foot">Projected range</div>
          </div>
        </div>
      </Panel>

      {/* Weeks table */}
      <Panel title="Week by week" sub="Nutrition adherence, treadmill volume and recovery" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Dates</th>
                <th>Weight avg</th>
                <th>Waist</th>
                <th>Calorie adherence</th>
                <th>Protein consistency</th>
                <th>Treadmill</th>
                <th>Sleep</th>
                <th>Readiness</th>
              </tr>
            </thead>
            <tbody>
              {weeks.filter((w) => !w.isFuture).slice(-10).map((w) => (
                <tr key={w.week}>
                  <td><span className="row" style={{ gap: 6 }}>W{w.week}{w.isCurrent && <span className="badge" data-tone="verified">Now</span>}</span></td>
                  <td className="tiny dim">{fmtDate(w.start)} – {fmtDate(w.end)}</td>
                  <td className="mono">{w.weightAvg ?? '—'}</td>
                  <td className="mono">{w.waist ?? '—'}</td>
                  <td className="mono">{w.calories != null ? `${w.calories}%` : '—'}</td>
                  <td className="mono">{w.protein != null ? `${w.protein}%` : '—'}</td>
                  <td className="mono">{w.treadmillMinutes} min</td>
                  <td className="mono">{w.sleep ?? '—'}</td>
                  <td className="mono">{w.readiness ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <WeighInModal open={weighOpen} onClose={() => setWeighOpen(false)} onSaved={load} initial={latest} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Weight chart with projection band                                   */
/* ------------------------------------------------------------------ */

function WeightProjectionChart({ series, projection, checkpoint, today, startDate, goalWeight }) {
  const width = 720;
  const height = 260;
  const pad = { top: 18, right: 16, bottom: 28, left: 44 };
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const points = series.filter((p) => p.rolling != null);
  if (points.length < 2) {
    return (
      <div style={{ height, display: 'grid', placeItems: 'center', border: '1px dashed var(--line)', borderRadius: 12, color: 'var(--text-dim)', fontSize: 12 }}>
        Log at least two weigh-ins to draw a trend.
      </div>
    );
  }

  const xStart = new Date(`${startDate}T12:00:00`).getTime();
  const xEnd = new Date(`${checkpoint}T12:00:00`).getTime();
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  const x = (dateKey) => {
    const t = new Date(`${dateKey}T12:00:00`).getTime();
    return pad.left + ((t - xStart) / (xEnd - xStart)) * (width - pad.left - pad.right);
  };

  const lows = projection.status === 'ok' ? [projection.low] : [];
  const highs = projection.status === 'ok' ? [projection.high] : [];
  const allY = [...points.map((p) => p.rolling), ...lows, ...highs, ...(goalWeight ? [goalWeight] : [])];
  const minY = Math.min(...allY) - 0.5;
  const maxY = Math.max(...allY) + 0.5;
  const y = (v) => pad.top + ((maxY - v) / (maxY - minY)) * (height - pad.top - pad.bottom);

  const rollingPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.rolling).toFixed(1)}`)
    .join(' ');
  const areaPath = `${rollingPath} L${x(points.at(-1).date).toFixed(1)},${height - pad.bottom} L${x(points[0].date).toFixed(1)},${height - pad.bottom} Z`;

  const last = points.at(-1);
  const projStart = { x: x(last.date), y: y(last.rolling) };
  const projEnd = projection.status === 'ok' ? { x: x(checkpoint), y: y(projection.projectedWeight) } : null;

  const bandPath = projection.status === 'ok'
    ? `M${projStart.x},${projStart.y} L${projEnd.x},${y(projection.low)} L${projEnd.x},${y(projection.high)} Z`
    : '';

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + (maxY - minY) * f);

  const onMove = (event) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = null;
    points.forEach((point, index) => {
      const px = x(point.date);
      const dist = Math.abs(px - relX);
      if (!nearest || dist < nearest.dist) nearest = { point, index, dist, px };
    });
    if (nearest) setHover(nearest);
  };

  const hoverPoint = hover ? points[hover.index] : null;

  return (
    <div className="weight-chart chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" style={{ height, width: '100%' }} role="img" aria-label="Weight trajectory with projection">
        <defs>
          <linearGradient id="weightArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="projBand" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {gridVals.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" />
            <text x={pad.left - 8} y={y(v) + 3} textAnchor="end" className="chart-axis-label">{v.toFixed(1)}</text>
          </g>
        ))}

        {[startDate, today, checkpoint].map((d, i) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={pad.top} y2={height - pad.bottom} stroke={i === 1 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)'} strokeDasharray={i === 1 ? '4 4' : undefined} />
            <text x={x(d)} y={height - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="chart-axis-label">
              {i === 1 ? 'Today' : fmtDate(d)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#weightArea)" />
        <path d={rollingPath} fill="none" stroke="var(--lime)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

        {projection.status === 'ok' && (
          <>
            <path d={bandPath} fill="url(#projBand)" stroke="none" />
            <line x1={projStart.x} y1={projStart.y} x2={projEnd.x} y2={projEnd.y} stroke="var(--teal)" strokeWidth="1.8" strokeDasharray="5 5" opacity="0.8" />
            <circle cx={projEnd.x} cy={projEnd.y} r="3" fill="var(--teal)" />
          </>
        )}

        {goalWeight && (
          <g>
            <line x1={pad.left} x2={width - pad.right} y1={y(goalWeight)} y2={y(goalWeight)} stroke="var(--violet)" strokeWidth="1" strokeDasharray="3 5" opacity="0.55" />
            <text x={width - pad.right} y={y(goalWeight) - 5} textAnchor="end" className="chart-axis-label" fill="var(--violet)">target {goalWeight} kg</text>
          </g>
        )}

        {series.filter((p) => p.weight != null).map((p) => (
          <circle key={p.date} cx={x(p.date)} cy={y(p.weight)} r="2" fill="rgba(255,255,255,0.4)" />
        ))}

        <circle cx={x(last.date)} cy={y(last.rolling)} r="4" fill="var(--lime)" stroke="#0a0c10" strokeWidth="2" />

        {hover && (
          <>
            <line x1={x(hover.point.date)} x2={x(hover.point.date)} y1={pad.top} y2={height - pad.bottom} stroke="rgba(255,255,255,0.24)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover.point.date)} cy={y(hover.point.rolling)} r="3.4" fill="var(--lime)" stroke="#0a0c10" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover && hoverPoint && (
        <div className="chart-tooltip" style={{ left: `${(x(hoverPoint.date) / width) * 100}%`, top: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>{fmtDate(hoverPoint.date)}</div>
          <div className="muted">7-day avg <span className="mono" style={{ color: 'var(--lime)', marginLeft: 6 }}>{hoverPoint.rolling} kg</span></div>
          {hoverPoint.weight != null && (
            <div className="muted">Weigh-in <span className="mono" style={{ color: 'var(--text)', marginLeft: 6 }}>{hoverPoint.weight} kg</span></div>
          )}
        </div>
      )}
    </div>
  );
}

function WaistChart({ series }) {
  const [waist, setWaist] = useState(null);
  useEffect(() => {
    // Waist points are sparse; pull them from the weigh-in series if available.
    const pts = series.filter((p) => p.waist != null);
    setWaist(pts);
  }, [series]);

  if (!waist || waist.length < 2) {
    return <div className="tiny dim" style={{ marginTop: 8 }}>Add waist measurements on at least two dates to chart the trend.</div>;
  }

  return (
    <LineChart
      height={120}
      yFormat={(v) => `${v.toFixed(0)}`}
      xFormat={(d) => fmtDate(d)}
      series={[
        {
          label: 'Waist (cm)',
          color: 'var(--teal)',
          points: waist.map((p) => ({ x: p.date, y: p.waist })),
        },
      ]}
    />
  );
}

function RecoveryMini({ recovery, weeks }) {
  const rows = weeks.filter((w) => !w.isFuture && w.sleep != null).slice(-8);
  if (rows.length === 0) {
    return <div className="tiny dim">Log sleep and readiness to see recovery trends.</div>;
  }
  return (
    <div>
      <div className="recovery-mini-grid">
        {rows.map((w) => (
          <div key={w.week} className="recovery-mini">
            <span className="tiny dim">W{w.week}</span>
            <div className="recovery-bar-wrap">
              <div className="recovery-sleep" style={{ height: `${Math.min(100, ((w.sleep || 0) / 9) * 100)}%` }} title={`${w.sleep}h sleep`} />
            </div>
            <span className="tiny mono">{w.sleep}h</span>
          </div>
        ))}
      </div>
      <div className="row-between" style={{ marginTop: 10 }}>
        <span className="tiny dim">Avg {recovery.avgSleep ?? '—'}h · readiness {recovery.avgReadiness ?? '—'}/5</span>
        <span className="chip">{recovery.trend}</span>
      </div>
    </div>
  );
}
