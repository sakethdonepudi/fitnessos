import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Panel, Button, Field, Note, Tabs, StatusBadge, Empty } from '../components/ui.jsx';
import {
  IconCheck,
  IconDumbbell,
  IconInfo,
  IconLock,
  IconRefreshCw,
  IconShield,
  IconWatch,
  IconTrash,
  IconPlus,
} from '../components/icons.jsx';
import { fmtDate, fmtDateTime, relativeTime, todayKeyLocal } from '../lib/format.js';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

export default function SettingsPage() {
  const { bootstrap, user, toast, refreshMe } = useApp();
  const [tab, setTab] = useState('profile');
  const [profileForm, setProfileForm] = useState(null);
  const [goalForm, setGoalForm] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [health, setHealth] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [newToken, setNewToken] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bootstrap) {
      setProfileForm({
        name: user?.name || '',
        timezone: user?.timezone || 'Asia/Kolkata',
        sex: bootstrap.profile?.sex || 'male',
        heightCm: bootstrap.profile?.height_cm ?? 183,
        startDate: bootstrap.profile?.start_date || '2026-10-19',
        checkpointDate: bootstrap.profile?.checkpoint_date || '2026-12-01',
        waistStartCm: bootstrap.profile?.waist_start_cm ?? 91.4,
      });
      setGoalForm({
        effectiveFrom: bootstrap.today,
        calories: bootstrap.goal?.calories ?? 2400,
        protein: bootstrap.goal?.protein_g ?? 175,
        carbs: bootstrap.goal?.carbs_g ?? '',
        fat: bootstrap.goal?.fat_g ?? '',
        waterMl: bootstrap.goal?.water_ml ?? 3000,
        stepGoal: bootstrap.goal?.step_goal ?? 10000,
        treadmillMinWeek: bootstrap.goal?.treadmill_min_week ?? 150,
        targetWeightKg: bootstrap.goal?.target_weight_kg ?? '',
      });
    }
  }, [bootstrap, user]);

  const loadHealth = async () => {
    try {
      const [t, h, j] = await Promise.all([api.get('/health/tokens'), api.get('/health/status'), api.get('/jobs')]);
      setTokens(t.tokens);
      setHealth(h);
      setJobs(j);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    if (tab === 'health' || tab === 'jobs') loadHealth();
  }, [tab]);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api.put('/profile', {
        name: profileForm.name,
        timezone: profileForm.timezone,
        sex: profileForm.sex,
        heightCm: Number(profileForm.heightCm),
        startDate: profileForm.startDate,
        checkpointDate: profileForm.checkpointDate,
        waistStartCm: Number(profileForm.waistStartCm),
      });
      toast('Profile saved', 'success');
      await refreshMe();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveGoal = async () => {
    setBusy(true);
    try {
      await api.post('/goals', {
        effectiveFrom: goalForm.effectiveFrom,
        calories: Number(goalForm.calories),
        protein: Number(goalForm.protein),
        carbs: goalForm.carbs === '' ? null : Number(goalForm.carbs),
        fat: goalForm.fat === '' ? null : Number(goalForm.fat),
        waterMl: Number(goalForm.waterMl),
        stepGoal: Number(goalForm.stepGoal),
        treadmillMinWeek: Number(goalForm.treadmillMinWeek),
        targetWeightKg: goalForm.targetWeightKg === '' ? null : Number(goalForm.targetWeightKg),
      });
      toast('Goal version saved. Earlier days keep their original targets.', 'success');
      await refreshMe();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const createToken = async () => {
    setBusy(true);
    try {
      const res = await api.post('/health/tokens', { label: 'iPhone companion' });
      setNewToken(res.token);
      toast('Device token created — copy it now, it is only shown once', 'success');
      loadHealth();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    try {
      await api.del(`/health/tokens/${id}`);
      toast('Token revoked', 'success');
      loadHealth();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Profile · goals · integrations</div>
          <h1 className="page-title">Settings</h1>
          <p className="lede">
            Goal changes are versioned by effective date. What you see for a past day is what applied then.
          </p>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'goals', label: 'Goals' },
          { id: 'health', label: 'Apple Health' },
          { id: 'jobs', label: 'Scheduled jobs' },
          { id: 'data', label: 'Data & audit' },
        ]}
      />

      {tab === 'profile' && profileForm && (
        <div className="settings-grid">
          <Panel title="Your profile" sub="Used for zone estimates and programme progress">
            <div className="form-grid">
              <Field label="Name">
                <input className="input" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
              </Field>
              <Field label="Timezone" hint="Drives the 11:55 PM closeout.">
                <select className="select" value={profileForm.timezone} onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })}>
                  {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
                </select>
              </Field>
              <Field label="Sex">
                <select className="select" value={profileForm.sex} onChange={(e) => setProfileForm({ ...profileForm, sex: e.target.value })}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Height (cm)">
                <input className="input" type="number" value={profileForm.heightCm} onChange={(e) => setProfileForm({ ...profileForm, heightCm: e.target.value })} />
              </Field>
              <Field label="Programme start">
                <input className="input" type="date" value={profileForm.startDate} onChange={(e) => setProfileForm({ ...profileForm, startDate: e.target.value })} />
              </Field>
              <Field label="Checkpoint">
                <input className="input" type="date" value={profileForm.checkpointDate} onChange={(e) => setProfileForm({ ...profileForm, checkpointDate: e.target.value })} />
              </Field>
              <Field label="Starting waist (cm)">
                <input className="input" type="number" step="0.1" value={profileForm.waistStartCm} onChange={(e) => setProfileForm({ ...profileForm, waistStartCm: e.target.value })} />
              </Field>
            </div>
            <div className="form-actions">
              <Button variant="primary" onClick={saveProfile} disabled={busy}>Save profile</Button>
            </div>
          </Panel>

          <div className="stack">
            <Panel title="Account" sub="Single-user private workspace">
              <div className="settings-kv"><span>Email</span><b>{user?.email}</b></div>
              <div className="settings-kv"><span>Account type</span><b>{user?.isDemo ? 'Demo (sample data)' : 'Personal'}</b></div>
              <div className="settings-kv"><span>Photo storage</span><b>Local disk, authenticated only</b></div>
              <Note tone="info" icon={<IconLock size={14} />}>
                All data lives in `data/fitness.db` on this machine. Back it up by copying that file and the `data/photos`
                folder.
              </Note>
            </Panel>

            <Panel title="Export" sub="Full JSON copy of your records">
              <a className="btn" href="/api/export" download>Download JSON export</a>
              <p className="tiny dim" style={{ marginTop: 10 }}>
                Includes meals, workouts, treadmill sessions, step counters, checkpoints and audit history.
              </p>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'goals' && goalForm && (
        <div className="settings-grid">
          <Panel title="Active targets" sub={`Effective from ${fmtDate(goalForm.effectiveFrom)}`}>
            <div className="form-grid">
              <Field label="Effective from">
                <input className="input" type="date" value={goalForm.effectiveFrom} onChange={(e) => setGoalForm({ ...goalForm, effectiveFrom: e.target.value })} />
              </Field>
              <Field label="Calories (kcal)">
                <input className="input" type="number" value={goalForm.calories} onChange={(e) => setGoalForm({ ...goalForm, calories: e.target.value })} />
              </Field>
              <Field label="Protein (g)">
                <input className="input" type="number" value={goalForm.protein} onChange={(e) => setGoalForm({ ...goalForm, protein: e.target.value })} />
              </Field>
              <Field label="Carbs (g)">
                <input className="input" type="number" value={goalForm.carbs} onChange={(e) => setGoalForm({ ...goalForm, carbs: e.target.value })} />
              </Field>
              <Field label="Fat (g)">
                <input className="input" type="number" value={goalForm.fat} onChange={(e) => setGoalForm({ ...goalForm, fat: e.target.value })} />
              </Field>
              <Field label="Water (ml)">
                <input className="input" type="number" value={goalForm.waterMl} onChange={(e) => setGoalForm({ ...goalForm, waterMl: e.target.value })} />
              </Field>
              <Field label="Qualifying step goal">
                <input className="input" type="number" value={goalForm.stepGoal} onChange={(e) => setGoalForm({ ...goalForm, stepGoal: e.target.value })} />
              </Field>
              <Field label="Treadmill min/week">
                <input className="input" type="number" value={goalForm.treadmillMinWeek} onChange={(e) => setGoalForm({ ...goalForm, treadmillMinWeek: e.target.value })} />
              </Field>
              <Field label="Target weight (kg)" hint="Optional. Shown as a reference line, not a deadline.">
                <input className="input" type="number" step="0.1" value={goalForm.targetWeightKg} onChange={(e) => setGoalForm({ ...goalForm, targetWeightKg: e.target.value })} />
              </Field>
            </div>
            <div className="form-actions">
              <Button variant="primary" onClick={saveGoal} disabled={busy}>Save goal version</Button>
            </div>
          </Panel>

          <Panel title="Goal history" sub="Versioned by effective date" flush>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Effective</th><th>Calories</th><th>Protein</th><th>Water</th><th>Steps</th></tr></thead>
                <tbody>
                  {(bootstrap?.goals || []).map((g) => (
                    <tr key={g.id}>
                      <td>{fmtDate(g.effective_from)}</td>
                      <td className="mono">{g.calories}</td>
                      <td className="mono">{g.protein_g} g</td>
                      <td className="mono">{g.water_ml} ml</td>
                      <td className="mono">{g.step_goal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 16 }}>
              <Note tone="warn" icon={<IconInfo size={14} />}>
                A change applies from its effective date forward. Historical checkpoints and adherence calculations keep
                the goal that was active on that day.
              </Note>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'health' && (
        <div className="settings-grid">
          <Panel title="Apple Health sync" sub="Minimal iPhone companion → direct import">
            <div className="health-status-grid">
              <div>
                <span className="eyebrow">Last sync</span>
                <div className="small" style={{ fontWeight: 600 }}>{health?.freshness?.lastSync ? relativeTime(health.freshness.lastSync) : 'Never'}</div>
              </div>
              <div>
                <span className="eyebrow">Sync health</span>
                {health?.freshness?.stale ? (
                  <StatusBadge status="pending_sync" />
                ) : (
                  <span className="badge" data-tone="verified"><span className="badge-dot" />Fresh</span>
                )}
              </div>
              <div>
                <span className="eyebrow">Indoor walks</span>
                <div className="small" style={{ fontWeight: 600 }}>{health?.workouts?.filter((w) => /walk/i.test(w.type)).length || 0} imported</div>
              </div>
            </div>

            <div className="settings-subhead">Device tokens</div>
            <div className="token-list">
              {tokens.length === 0 && <div className="tiny dim">No device token yet. Create one and paste it into the companion app.</div>}
              {tokens.map((t) => (
                <div className="token-row" key={t.id}>
                  <IconWatch size={16} />
                  <div style={{ flex: 1 }}>
                    <div className="small">{t.label}</div>
                    <div className="tiny dim">
                      Created {fmtDate(t.created_at?.slice(0, 10))} · {t.last_used_at ? `last used ${relativeTime(t.last_used_at)}` : 'never used'}
                    </div>
                  </div>
                  <button className="icon-btn" onClick={() => revoke(t.id)} aria-label="Revoke"><IconTrash size={14} /></button>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <Button size="sm" onClick={createToken} disabled={busy}><IconPlus size={14} /> Create device token</Button>
            </div>

            {newToken && (
              <div className="new-token">
                <div className="tiny dim" style={{ marginBottom: 4 }}>Copy this token now — it will not be shown again.</div>
                <code>{newToken}</code>
              </div>
            )}
          </Panel>

          <div className="stack">
            <Panel title="Companion setup" sub="No third-party data broker">
              <ol className="setup-steps">
                <li>Open <code>ios-companion/</code> in Xcode on a Mac. Set your signing team and run it on your iPhone.</li>
                <li>Create a device token above and paste it into the app.</li>
                <li>Grant HealthKit read access for steps, heart rate, active energy and workouts.</li>
                <li>Tap “Sync now”. The app posts to <code>/api/health/sync</code> with a Bearer token.</li>
              </ol>
              <Note tone="info" icon={<IconInfo size={14} />}>
                HealthKit does not expose treadmill belt speed or incline. Those stay manual, or come from a supported
                treadmill integration — always labelled accordingly.
              </Note>
            </Panel>

            <Panel title="Cloud relay" sub="For syncing outside your local network">
              <p className="small muted">
                The companion expects a base URL you control. For sync while away from home, expose this server through a
                private tunnel (Tailscale, Cloudflare Tunnel with access policy, or a VPN) and point the companion at it.
                Do not open the API to the public internet without TLS and an access policy.
              </p>
            </Panel>

            <Panel title="Recent imports" sub="Raw sync receipts" flush>
              {!health?.syncs?.length ? (
                <Empty title="No imports yet">Sync from the companion or post a payload to the API.</Empty>
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
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="settings-grid">
          <Panel title="Daily closeout" sub="11:55 PM in your timezone">
            <div className="settings-kv"><span>Timezone</span><b>{jobs?.timezone}</b></div>
            <div className="settings-kv"><span>Next run</span><b>{jobs?.nextCloseout ? fmtDateTime(jobs.nextCloseout) : '—'}</b></div>
            <div className="settings-kv"><span>Snapshot rule</span><b>Immutable + reconciled later</b></div>
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <Button size="sm" onClick={async () => {
                try {
                  const res = await api.post('/checkpoints', { date: bootstrap.today });
                  toast(res.created ? 'Checkpoint created' : 'Checkpoint already exists', 'success');
                } catch (err) { toast(err.message, 'error'); }
              }}>
                <IconRefreshCw size={14} /> Run closeout now
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                try {
                  const res = await api.post(`/checkpoints/${bootstrap.today}/reconcile`);
                  toast(res.reconciled ? `Reconciled ${res.changes.length} fields` : `No changes: ${res.reason}`, 'success');
                } catch (err) { toast(err.message, 'error'); }
              }}>
                Reconcile today
              </Button>
            </div>
            <Note tone="info" icon={<IconInfo size={14} />}>
              The scheduler runs in the API process. Keep `npm start` running (or use a process manager) for automatic
              closeouts. The “run now” button is the same code path, for testing.
            </Note>
          </Panel>

          <Panel title="Job history" sub="Every scheduled or manual run" flush>
            {!jobs?.runs?.length ? (
              <Empty title="No job runs recorded">Closeouts and reconciliations appear here.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Job</th><th>For</th><th>Status</th><th>Finished</th><th>Detail</th></tr></thead>
                  <tbody>
                    {jobs.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="tiny">{r.name}</td>
                        <td className="tiny mono">{r.run_date}</td>
                        <td><StatusBadge status={r.status === 'ok' ? 'verified_device' : 'needs_review'} short /></td>
                        <td className="tiny">{fmtDateTime(r.finished_at)}</td>
                        <td className="tiny dim truncate" style={{ maxWidth: 220 }}>{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'data' && <AuditPanel />}
    </div>
  );
}

function AuditPanel() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get('/audit?limit=120').then((r) => setRows(r.rows || [])).catch(() => {});
  }, []);

  return (
    <Panel title="Audit history" sub="Every write to your records, with before/after snapshots" flush>
      {rows.length === 0 ? (
        <Empty title="No audit entries yet">Creating a weigh-in, meal or goal change will appear here.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Entity</th><th>Action</th><th>ID</th><th>Change</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="tiny">{fmtDateTime(r.at)}</td>
                  <td className="tiny">{r.entity}</td>
                  <td><span className="badge" data-tone="logged">{r.action}</span></td>
                  <td className="tiny mono">{r.entity_id || '—'}</td>
                  <td className="tiny dim truncate" style={{ maxWidth: 420 }}>
                    {summarise(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function summarise(row) {
  try {
    const after = row.after_json ? JSON.parse(row.after_json) : null;
    const before = row.before_json ? JSON.parse(row.before_json) : null;
    if (after && typeof after === 'object') {
      const keys = Object.keys(after).slice(0, 3);
      return keys.map((k) => `${k}: ${JSON.stringify(after[k])}`).join(' · ');
    }
    if (before) return 'removed';
    return '—';
  } catch {
    return '—';
  }
}
