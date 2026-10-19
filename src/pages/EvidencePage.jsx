import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Panel, Button, StatusBadge, Note, Empty, Tabs, Modal, ProgressBar } from '../components/ui.jsx';
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconInfo,
  IconRefreshCw,
  IconShield,
  IconWatch,
  IconSteps,
  IconTreadmill,
  IconMeal,
  IconDroplet,
  IconHeart,
  IconScale,
  IconCamera,
} from '../components/icons.jsx';
import { fmtNum, fmtPct, fmtDate, fmtDateTime, fmtMinutes, relativeTime } from '../lib/format.js';

const GOAL_ICONS = {
  nutrition: IconMeal,
  water: IconDroplet,
  workout: IconHeart,
  treadmill: IconTreadmill,
  steps: IconSteps,
  bodyweight: IconScale,
};

export default function EvidencePage() {
  const { bootstrap, toast, dataVersion } = useApp();
  const [tab, setTab] = useState('today');
  const [evidence, setEvidence] = useState(null);
  const [checkpoints, setCheckpoints] = useState([]);
  const [health, setHealth] = useState(null);
  const [active, setActive] = useState(null);
  const [steps, setSteps] = useState(null);

  const load = async () => {
    try {
      const [e, c, h, s] = await Promise.all([
        api.get('/evidence'),
        api.get('/checkpoints'),
        api.get('/health/status'),
        api.get('/steps'),
      ]);
      setEvidence(e);
      setCheckpoints(c.checkpoints || []);
      setHealth(h);
      setSteps(s);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
  }, [dataVersion]);

  const openCheckpoint = async (date) => {
    try {
      setActive(await api.get(`/checkpoints/${date}`));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const runCheckpoint = async () => {
    try {
      const res = await api.post('/checkpoints', { date: bootstrap.today });
      toast(res.created ? 'Checkpoint created for today' : 'Checkpoint already exists for today', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const reconcile = async (date) => {
    try {
      const res = await api.post(`/checkpoints/${date}/reconcile`);
      toast(res.reconciled ? `Reconciled ${res.changes.length} field(s) without rewriting the original` : `No changes (${res.reason})`, 'success');
      await openCheckpoint(date);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const goals = evidence?.goals || {};
  const counts = Object.values(goals).reduce((acc, g) => {
    acc[g.status] = (acc[g.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Every goal, its evidence, and the 11:55 PM snapshot</div>
          <h1 className="page-title">Evidence</h1>
          <p className="lede">
            “Not recorded” means exactly that. It is never a claim that something did not happen. Device data, manual
            logs and estimates are kept distinct.
          </p>
        </div>
        <Button size="sm" onClick={runCheckpoint}><IconClock size={14} /> Run closeout now</Button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'today', label: 'Today' },
          { id: 'checkpoints', label: 'Daily checkpoints', count: checkpoints.length },
          { id: 'sources', label: 'Data sources' },
        ]}
      />

      {tab === 'today' && evidence && (
        <>
          <div className="evidence-summary">
            <div className="evidence-summary-item">
              <span className="evidence-dot" style={{ background: 'var(--lime)' }} />
              <div><div className="num">{counts.verified_device || 0}</div><div className="tiny dim">Verified by device</div></div>
            </div>
            <div className="evidence-summary-item">
              <span className="evidence-dot" style={{ background: 'var(--teal)' }} />
              <div><div className="num">{counts.logged_user || 0}</div><div className="tiny dim">Logged by you</div></div>
            </div>
            <div className="evidence-summary-item">
              <span className="evidence-dot" style={{ background: 'var(--violet)' }} />
              <div><div className="num">{counts.ai_estimated || 0}</div><div className="tiny dim">AI estimated</div></div>
            </div>
            <div className="evidence-summary-item">
              <span className="evidence-dot" style={{ background: 'var(--amber)' }} />
              <div><div className="num">{counts.pending_sync || 0}</div><div className="tiny dim">Pending sync</div></div>
            </div>
            <div className="evidence-summary-item">
              <span className="evidence-dot" style={{ background: 'var(--red)' }} />
              <div><div className="num">{counts.needs_review || 0}</div><div className="tiny dim">Needs review</div></div>
            </div>
            <div className="evidence-summary-item">
              <span className="evidence-dot" style={{ background: 'var(--text-dim)' }} />
              <div><div className="num">{counts.not_recorded || 0}</div><div className="tiny dim">Not recorded</div></div>
            </div>
          </div>

          <div className="evidence-grid">
            {Object.entries(goals).map(([key, g]) => {
              const Icon = GOAL_ICONS[key] || IconShield;
              const req = evidence.requirements?.[key];
              return (
                <Panel key={key} className="evidence-card">
                  <div className="evidence-card-head">
                    <span className="list-icon"><Icon size={16} /></span>
                    <div style={{ flex: 1 }}>
                      <div className="small" style={{ fontWeight: 600 }}>{req?.label || key}</div>
                      <div className="tiny dim">{g.detail}</div>
                    </div>
                    <StatusBadge status={g.status} />
                  </div>
                  {req && (
                    <div className="evidence-requirement">
                      <div className="evidence-requirement-row"><span className="eyebrow">Required</span><p className="tiny muted">{req.rule}</p></div>
                      <div className="evidence-requirement-row"><span className="eyebrow">Counts as verified</span><p className="tiny muted">{req.verifiedWhen}</p></div>
                      {req.fallback && <div className="evidence-requirement-row"><span className="eyebrow">Fallback</span><p className="tiny muted">{req.fallback}</p></div>}
                    </div>
                  )}
                </Panel>
              );
            })}
          </div>

          <div className="two-up">
            <Panel title="Today's read" sub={fmtDate(bootstrap.today, { year: true })}>
              <div className="today-evidence-lines">
                <div className="today-evidence-line"><span>Calories</span><b className="mono">{fmtNum(goals.nutrition && bootstrap.nutrition.totals.calories)} / {fmtNum(bootstrap.goal?.calories)}</b><StatusBadge status={goals.nutrition?.status} short /></div>
                <div className="today-evidence-line"><span>Protein</span><b className="mono">{fmtNum(bootstrap.nutrition.totals.protein)} / {fmtNum(bootstrap.goal?.protein_g)} g</b><StatusBadge status={goals.nutrition?.status} short /></div>
                <div className="today-evidence-line"><span>Water</span><b className="mono">{fmtNum(bootstrap.water.ml)} / {fmtNum(bootstrap.goal?.water_ml)} ml</b><StatusBadge status={goals.water?.status} short /></div>
                <div className="today-evidence-line"><span>Treadmill</span><b className="mono">{fmtNum(bootstrap.treadmill.totals.minutes)} min</b><StatusBadge status={goals.treadmill?.status} short /></div>
                <div className="today-evidence-line"><span>Qualifying steps</span><b className="mono">{fmtNum(bootstrap.steps.qualifying_steps)}</b><StatusBadge status={goals.steps?.status} short /></div>
              </div>
              <Note tone="info" icon={<IconInfo size={14} />}>
                A missing photo is not a missed workout. A missing meal log is not zero intake. Status reflects record
                provenance, not effort.
              </Note>
            </Panel>

            <Panel title="Health sync" sub="Device-dependent totals">
              <div className="health-detail">
                <div className="health-detail-row"><span>Sync health</span>{evidence.health?.stale ? <StatusBadge status="pending_sync" /> : <span className="badge" data-tone="verified"><span className="badge-dot" />Fresh</span>}</div>
                <div className="health-detail-row"><span>Last sync</span><b>{evidence.health?.lastSync ? fmtDateTime(evidence.health.lastSync) : 'Never'}</b></div>
                <div className="health-detail-row"><span>Age</span><b>{evidence.health?.lastSync ? relativeTime(evidence.health.lastSync) : '—'}</b></div>
                <div className="health-detail-row"><span>Stale threshold</span><b>26 hours</b></div>
              </div>
              {evidence.health?.stale && (
                <Note tone="warn" icon={<IconAlert size={14} />}>
                  Apple Health has not synced recently. Step totals and other device-dependent metrics are marked Pending
                  Sync until it does. They are not treated as zero.
                </Note>
              )}
              <Button size="sm" variant="ghost" style={{ marginTop: 12 }} onClick={load}><IconRefreshCw size={13} /> Refresh</Button>
            </Panel>
          </div>
        </>
      )}

      {tab === 'checkpoints' && (
        <Panel
          title="Daily checkpoints"
          sub="11:55 PM Asia/Kolkata · immutable snapshots"
          action={<Button size="sm" onClick={runCheckpoint}><IconClock size={13} /> Snapshot today</Button>}
          flush
        >
          {checkpoints.length === 0 ? (
            <Empty icon={<IconClock size={20} />} title="No checkpoints yet">
              A snapshot is created automatically at 11:55 PM, or you can run one now.
            </Empty>
          ) : (
            <div className="checkpoint-list">
              {checkpoints.map((cp) => (
                <button className="checkpoint-row" key={cp.id} onClick={() => openCheckpoint(cp.date)}>
                  <div className="checkpoint-date">
                    <span className="checkpoint-day">{new Date(`${cp.date}T12:00:00`).getDate()}</span>
                    <span className="tiny dim">{new Date(`${cp.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' })}</span>
                  </div>
                  <div className="checkpoint-main">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="small" style={{ fontWeight: 600 }}>{fmtDate(cp.date, { year: true })}</span>
                      {cp.status === 'reconciled' && <span className="badge" data-tone="pending">Reconciled</span>}
                      {cp.status === 'final' && <span className="badge" data-tone="logged">Final</span>}
                    </div>
                    <div className="tiny dim" style={{ marginTop: 3 }}>
                      {cp.snapshot?.nutrition?.calories ?? 0} kcal · {cp.snapshot?.steps?.qualifying ?? '—'} qualifying steps ·{' '}
                      {cp.snapshot?.treadmill?.minutes ?? 0} treadmill min
                    </div>
                  </div>
                  <div className="checkpoint-flags">
                    {cp.snapshot?.outstanding?.length > 0 && (
                      <span className="badge" data-tone="pending">{cp.snapshot.outstanding.length} outstanding</span>
                    )}
                    <StatusBadge status={cp.snapshot?.steps?.status || 'pending_sync'} short />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === 'sources' && (
        <div className="two-up">
          <Panel title="Apple Health imports" sub="Raw sync receipts" flush>
            {!health?.syncs?.length ? (
              <Empty icon={<IconWatch size={20} />} title="No imports yet">
                Set up the iPhone companion in Settings → Apple Health.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Received</th><th>Source</th><th>Samples</th><th>Workouts</th></tr></thead>
                  <tbody>
                    {health.syncs.map((s) => (
                      <tr key={s.id}>
                        <td className="tiny">{fmtDateTime(s.received_at)}</td>
                        <td className="tiny">{s.source}</td>
                        <td className="mono">{s.step_samples_count}</td>
                        <td className="mono">{s.workouts_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Step accounting" sub="De-duplication across iPhone and Apple Watch" flush>
            <div style={{ padding: 16 }}>
              <div className="steps-source-grid">
                <div><span className="eyebrow">A · Total</span><div className="num">{fmtNum(bootstrap.steps.total_steps)}</div></div>
                <div><span className="eyebrow">B · Treadmill</span><div className="num">{fmtNum(bootstrap.steps.treadmill_steps)}</div></div>
                <div><span className="eyebrow">C · Qualifying</span><div className="num" style={{ color: 'var(--violet)' }}>{fmtNum(bootstrap.steps.qualifying_steps)}</div></div>
              </div>
              <div className="tiny dim" style={{ marginTop: 10 }}>
                Method: {bootstrap.steps.method?.replaceAll('_', ' ')} · ±{bootstrap.steps.uncertainty_pct}% uncertainty
              </div>
              <div style={{ marginTop: 10 }}>
                <ProgressBar value={bootstrap.steps.qualifying_steps || 0} max={bootstrap.goal?.step_goal || 10000} tone="violet" />
              </div>
              <Note tone="info" icon={<IconInfo size={14} />}>
                Where iPhone and Watch cover the same minutes, one source is chosen per minute rather than summing both.
                The uncertainty figure is the observed disagreement between sources.
              </Note>
            </div>
          </Panel>

          <Panel title="Recent step days" sub="A, B and C by day" flush>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Total</th><th>Treadmill</th><th>Qualifying</th><th>Uncertainty</th></tr></thead>
                <tbody>
                  {[...(steps?.rows || [])].reverse().slice(0, 10).map((s) => (
                    <tr key={s.date}>
                      <td>{fmtDate(s.date)}</td>
                      <td className="mono">{fmtNum(s.total_steps)}</td>
                      <td className="mono">{fmtNum(s.treadmill_steps)}</td>
                      <td className="mono" style={{ color: 'var(--violet)' }}>{fmtNum(s.qualifying_steps)}</td>
                      <td className="mono">±{s.uncertainty_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Verification vocabulary" sub="What each label means">
            <div className="vocab-list">
              {Object.entries(evidence?.statusMeta || {}).map(([key, meta]) => (
                <div className="vocab-row" key={key}>
                  <StatusBadge status={key} />
                  <span className="tiny muted">{meta.description}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <CheckpointModal checkpoint={active} onClose={() => setActive(null)} onReconcile={reconcile} />
    </div>
  );
}

function CheckpointModal({ checkpoint, onClose, onReconcile }) {
  if (!checkpoint) return null;
  const s = checkpoint.snapshot || {};
  const reconciled = checkpoint.reconciled;

  return (
    <Modal
      open={!!checkpoint}
      onClose={onClose}
      title={`Checkpoint · ${fmtDate(checkpoint.date, { year: true })}`}
      sub={`Created ${fmtDateTime(checkpoint.created_at)} · ${checkpoint.status}`}
      wide
    >
      <div className="checkpoint-detail">
        {reconciled && (
          <div className="reconcile-banner">
            <div className="row" style={{ gap: 8 }}>
              <IconRefreshCw size={14} />
              <span className="small" style={{ fontWeight: 600 }}>Reconciled {relativeTime(reconciled.at)}</span>
            </div>
            <div className="reconcile-changes">
              {reconciled.changes.map((c) => (
                <div key={c.path} className="reconcile-change">
                  <span className="mono tiny">{c.path}</span>
                  <span className="tiny dim">{JSON.stringify(c.before)} → {JSON.stringify(c.after)}</span>
                </div>
              ))}
            </div>
            <p className="tiny dim" style={{ marginTop: 6 }}>
              Original snapshot kept intact. These values were appended when delayed records arrived.
            </p>
          </div>
        )}

        <div className="checkpoint-section">
          <div className="eyebrow">Nutrition & hydration</div>
          <div className="checkpoint-kv-grid">
            <div><span>Calories</span><b className="mono">{s.nutrition?.calories ?? '—'} / {s.nutrition?.calorieTarget ?? '—'}</b></div>
            <div><span>Protein</span><b className="mono">{s.nutrition?.protein ?? '—'} / {s.nutrition?.proteinTarget ?? '—'} g</b></div>
            <div><span>Water</span><b className="mono">{s.water?.ml ?? '—'} / {s.water?.targetMl ?? '—'} ml</b></div>
            <div><span>Meals logged</span><b className="mono">{s.nutrition?.mealCount ?? 0}</b></div>
          </div>
        </div>

        <div className="checkpoint-section">
          <div className="eyebrow">Training</div>
          <div className="checkpoint-kv-grid">
            <div><span>Gym sessions</span><b className="mono">{s.workout?.count ?? 0}</b></div>
            <div><span>Splits</span><b>{s.workout?.splits?.join(', ') || '—'}</b></div>
            <div><span>Treadmill sessions</span><b className="mono">{s.treadmill?.sessions ?? 0}</b></div>
            <div><span>Treadmill minutes</span><b className="mono">{s.treadmill?.minutes ?? 0}</b></div>
          </div>
        </div>

        <div className="checkpoint-section">
          <div className="eyebrow">Steps</div>
          <div className="checkpoint-kv-grid">
            <div><span>Total HealthKit</span><b className="mono">{fmtNum(s.steps?.total)}</b></div>
            <div><span>Treadmill attributed</span><b className="mono">{fmtNum(s.steps?.treadmill)}</b></div>
            <div><span>Qualifying</span><b className="mono" style={{ color: 'var(--violet)' }}>{fmtNum(s.steps?.qualifying)}</b></div>
            <div><span>Method</span><b className="tiny">{s.steps?.method?.replaceAll('_', ' ') || '—'}</b></div>
          </div>
          {s.steps?.pendingBecause === 'health_not_synced' && (
            <Note tone="warn" icon={<IconAlert size={13} />}>
              This snapshot was taken while Apple Health had not synced. Device totals were marked Pending Sync.
            </Note>
          )}
        </div>

        <div className="checkpoint-section">
          <div className="eyebrow">Body & recovery</div>
          <div className="checkpoint-kv-grid">
            <div><span>Weight</span><b className="mono">{s.body?.weightKg ?? '—'} kg</b></div>
            <div><span>7-day average</span><b className="mono">{s.body?.sevenDayAverage ?? '—'} kg</b></div>
            <div><span>Waist</span><b className="mono">{s.body?.waistCm ?? '—'} cm</b></div>
            <div><span>Body fat</span><b className="mono">{s.body?.bodyFatPct != null ? `${s.body.bodyFatPct}% (${s.body.bodyFatSource === 'estimate' ? 'estimated' : 'measured'})` : '—'}</b></div>
            <div><span>Sleep</span><b className="mono">{s.recovery?.sleepHours ?? '—'} h</b></div>
            <div><span>Readiness</span><b className="mono">{s.recovery?.readiness ?? '—'}/5</b></div>
          </div>
        </div>

        <div className="checkpoint-section">
          <div className="eyebrow">Evidence summary</div>
          <div className="checkpoint-evidence">
            {Object.entries(s.evidenceSummary?.statuses || {}).map(([key, status]) => (
              <div className="checkpoint-evidence-row" key={key}>
                <span className="small" style={{ textTransform: 'capitalize' }}>{key}</span>
                <StatusBadge status={status} short />
              </div>
            ))}
          </div>
        </div>

        {s.outstanding?.length > 0 && (
          <div className="checkpoint-section">
            <div className="eyebrow">Outstanding items</div>
            <div className="stack" style={{ gap: 7, marginTop: 6 }}>
              {s.outstanding.map((item, i) => (
                <div className="outstanding-item" key={i}>
                  <IconAlert size={13} />
                  <div>
                    <div className="tiny" style={{ fontWeight: 600 }}>{item.label}</div>
                    <div className="tiny dim">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={() => onReconcile(checkpoint.date)}><IconRefreshCw size={14} /> Reconcile now</Button>
        </div>
      </div>
    </Modal>
  );
}
