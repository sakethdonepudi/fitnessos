import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Panel, Button, Field, Note, Tabs, StatusBadge, Empty, Modal, Input } from '../components/ui.jsx';
import {
  IconCheck,
  IconCloud,
  IconInfo,
  IconLock,
  IconRefreshCw,
  IconShield,
  IconWatch,
  IconTrash,
  IconPlus,
  IconDownload,
  IconUpload,
  IconAlert,
  IconSmartphone,
} from '../components/icons.jsx';
import { fmtDate, fmtDateTime, relativeTime, todayKeyLocal } from '../lib/format.js';
import { remote } from '../data/remote.js';
import { syncNow } from '../data/sync.js';
import { db } from '../data/db.js';
import {
  createBackup,
  readBackupFile,
  restoreBackup,
  downloadJson,
  downloadText,
  exportCsv,
  importLegacyExport,
  deleteAllLocalData,
} from '../data/backup.js';
import { parseHealthFile, summarizeImport } from '../data/health-import.js';
import { localCheckpointSummary } from '../data/checkpoints.js';

const TIMEZONES = ['Asia/Kolkata'];

export default function SettingsPage() {
  const { bootstrap, user, toast, refreshMe, sync, connectCloud, disconnectCloud } = useApp();
  const [tab, setTab] = useState('profile');
  const [profileForm, setProfileForm] = useState(null);
  const [goalForm, setGoalForm] = useState(null);
  const [health, setHealth] = useState(null);
  const [imports, setImports] = useState([]);
  const [devices, setDevices] = useState([]);
  const [newDeviceToken, setNewDeviceToken] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [localJobs, setLocalJobs] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cloudModal, setCloudModal] = useState(false);
  const [cloudForm, setCloudForm] = useState({ apiUrl: localStorage.getItem('fos.apiUrl') || import.meta.env.VITE_API_URL || '', passphrase: '', setupToken: '' });
  const [backupModal, setBackupModal] = useState(false);
  const [backupForm, setBackupForm] = useState({ passphrase: '', confirm: '', encrypt: true });
  const [restoreModal, setRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreMode, setRestoreMode] = useState('merge');
  const [deleteLocalOpen, setDeleteLocalOpen] = useState(false);
  const [deleteCloudOpen, setDeleteCloudOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletePassphrase, setDeletePassphrase] = useState('');
  const [importingHealth, setImportingHealth] = useState(false);
  const healthInputRef = useRef(null);
  const legacyInputRef = useRef(null);

  useEffect(() => {
    if (bootstrap) {
      setProfileForm({
        name: bootstrap.user?.name || '',
        timezone: 'Asia/Kolkata',
        sex: bootstrap.profile?.sex || 'male',
        heightCm: bootstrap.profile?.height_cm ?? 183,
        startDate: bootstrap.profile?.start_date || todayKeyLocal(),
        checkpointDate: bootstrap.profile?.checkpoint_date || '2026-12-01',
        waistStartCm: bootstrap.profile?.waist_start_cm ?? 91.44,
      });
      setGoalForm({
        effectiveFrom: bootstrap.today,
        calories: bootstrap.goal?.calories ?? 2400,
        protein: bootstrap.goal?.protein_g ?? 175,
        carbs: bootstrap.goal?.carbs_g ?? 240,
        fat: bootstrap.goal?.fat_g ?? 70,
        waterMl: bootstrap.goal?.water_ml ?? 3250,
        stepGoal: bootstrap.goal?.step_goal ?? 10000,
        treadmillMinWeek: bootstrap.goal?.treadmill_min_week ?? 150,
        targetWeightKg: bootstrap.goal?.target_weight_kg ?? 84,
      });
    }
  }, [bootstrap]);

  const loadHealth = async () => {
    try {
      const status = await api.get('/health/status');
      setHealth(status);
      setImports(status.syncs || []);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const loadCloud = async () => {
    if (!localStorage.getItem('fos.sessionToken')) {
      setDevices([]);
      setJobs(null);
      return;
    }
    try {
      const [d, j] = await Promise.all([remote.devices(), remote.jobs()]);
      setDevices(d.devices || []);
      setJobs(j);
    } catch (err) {
      // Cloud may be unreachable while offline; keep local views working.
    }
  };

  const loadAudit = async () => {
    const local = await db.audit.orderBy('at').reverse().limit(120).toArray();
    let merged = local.map((r) => ({ ...r, source: 'local' }));
    if (sync?.authenticated && navigator.onLine) {
      try {
        const remoteAudit = await remote.audit(100);
        merged = [
          ...(remoteAudit.rows || []).map((r) => ({ id: `remote-${r.id}`, at: r.at, action: r.action, entity: r.entity, detail: r.detail, source: 'cloud' })),
          ...merged,
        ].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
      } catch {
        // ignore
      }
    }
    setAuditRows(merged);
  };

  useEffect(() => {
    loadHealth();
    loadAudit();
    localCheckpointSummary().then(setLocalJobs).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'cloud') loadCloud();
    if (tab === 'audit') loadAudit();
    if (tab === 'jobs') {
      loadCloud();
      localCheckpointSummary().then(setLocalJobs).catch(() => {});
    }
  }, [tab, sync?.authenticated]);

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

  const submitCloud = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await connectCloud({
        apiUrl: cloudForm.apiUrl,
        passphrase: cloudForm.passphrase,
        setupToken: cloudForm.setupToken || null,
      });
      setCloudModal(false);
      setCloudForm((f) => ({ ...f, passphrase: '', setupToken: '' }));
      await loadCloud();
      await loadAudit();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const createDevice = async () => {
    setBusy(true);
    try {
      const res = await remote.createDevice('iPhone companion');
      setNewDeviceToken(res.token);
      toast('Device token created — copy it now, it is shown once.', 'success');
      await loadCloud();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokeDevice = async (id) => {
    try {
      await remote.revokeDevice(id);
      toast('Device revoked', 'success');
      await loadCloud();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleHealthImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportingHealth(true);
    try {
      const parsed = await parseHealthFile(file);
      const summary = summarizeImport(parsed);
      const result = await api.post('/health/import', { payload: parsed.payload, fileName: file.name });
      toast(`Imported ${result.samples} step samples and ${result.workouts} workouts`, 'success');
      if (result.errors?.length) toast(`${result.errors.length} record(s) were skipped; see Health import history.`, 'error');
      await loadHealth();
      await refreshMe();
      void summary;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImportingHealth(false);
    }
  };

  const runCloseout = async () => {
    setBusy(true);
    try {
      if (sync?.authenticated && navigator.onLine) {
        const res = await remote.runJob(bootstrap?.today);
        toast(`Server closeout ran for ${res.details?.length || 0} day(s).`, 'success');
        await loadCloud();
      } else {
        const res = await api.post('/checkpoints', { date: bootstrap?.today });
        toast(res.created ? 'Local checkpoint created' : 'Checkpoint already exists', 'success');
      }
      await refreshMe();
      localCheckpointSummary().then(setLocalJobs).catch(() => {});
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = async () => {
    if (backupForm.encrypt && backupForm.passphrase.length < 12) {
      toast('Use a backup passphrase of at least 12 characters, or turn encryption off.', 'error');
      return;
    }
    if (backupForm.encrypt && backupForm.passphrase !== backupForm.confirm) {
      toast('Backup passphrases do not match.', 'error');
      return;
    }
    setBusy(true);
    try {
      const backup = await createBackup({
        passphrase: backupForm.encrypt ? backupForm.passphrase : '',
        includePhotos: true,
      });
      downloadJson(`fitness-os-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
      toast(backupForm.encrypt ? 'Encrypted backup downloaded' : 'Backup downloaded (unencrypted)', 'success');
      setBackupModal(false);
      setBackupForm({ passphrase: '', confirm: '', encrypt: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const inspectRestore = async () => {
    if (!restoreFile) return;
    setBusy(true);
    try {
      const backup = await readBackupFile(restoreFile, restorePassphrase);
      setRestorePreview(backup);
    } catch (err) {
      toast(err.message, 'error');
      setRestorePreview(null);
    } finally {
      setBusy(false);
    }
  };

  const applyRestore = async () => {
    if (!restorePreview) return;
    setBusy(true);
    try {
      const result = await restoreBackup(restorePreview, { mode: restoreMode });
      toast(`${restoreMode === 'replace' ? 'Replaced' : 'Merged'} ${result.imported} records (${result.skipped} duplicates skipped).`, 'success');
      setRestoreModal(false);
      setRestorePreview(null);
      setRestoreFile(null);
      setRestorePassphrase('');
      await refreshMe();
      await loadHealth();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLegacyImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const result = await importLegacyExport(file);
      toast(`Imported ${result.imported} legacy records across ${result.collections} collections.`, 'success');
      await refreshMe();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCloud = async () => {
    setBusy(true);
    try {
      const data = await remote.exportAccount(true);
      downloadJson(`fitness-os-cloud-export-${new Date().toISOString().slice(0, 10)}.json`, data);
      toast('Cloud export downloaded', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDeleteLocal = async () => {
    if (deleteConfirm !== 'DELETE') return;
    await deleteAllLocalData();
  };

  const doDeleteCloud = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setBusy(true);
    try {
      await remote.deleteAccount(deletePassphrase);
      await disconnectCloud();
      toast('Cloud account deleted. Local data was left untouched.', 'success');
      setDeleteCloudOpen(false);
      setDeleteConfirm('');
      setDeletePassphrase('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cloudConnected = !!sync?.authenticated;

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Profile · cloud sync · local data</div>
          <h1 className="page-title">Settings</h1>
          <p className="lede">
            Local-first by default. Add Cloudflare sync when you want the same records on your iPhone and Mac; the app
            keeps working offline either way.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="sync-pill" style={{ height: 30 }}>
            <span className="sync-dot" style={{ background: cloudConnected ? 'var(--lime)' : 'var(--text-dim)' }} />
            {cloudConnected ? 'Cloud connected' : 'Local only'}
          </span>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'goals', label: 'Goals' },
          { id: 'cloud', label: 'Cloud & Apple Health' },
          { id: 'backup', label: 'Data & Backup' },
          { id: 'jobs', label: 'Scheduled jobs' },
          { id: 'audit', label: 'Audit' },
        ]}
      />

      {tab === 'profile' && profileForm && (
        <div className="settings-grid">
          <Panel title="Your profile" sub="Used for progress and zone estimates">
            <div className="form-grid">
              <Field label="Name">
                <input className="input" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
              </Field>
              <Field label="Timezone" hint="Daily closeout uses Asia/Kolkata.">
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
            <Panel title="Account mode" sub="No server password in the bundle">
              <div className="settings-kv"><span>Local records</span><b>IndexedDB on this device</b></div>
              <div className="settings-kv"><span>Cloud records</span><b>{cloudConnected ? 'Cloudflare D1' : 'Not connected'}</b></div>
              <div className="settings-kv"><span>Photos</span><b>{cloudConnected ? 'Private R2 bucket' : 'Local IndexedDB'}</b></div>
              <div className="settings-kv"><span>Last sync</span><b>{sync?.lastSync ? relativeTime(sync.lastSync) : 'Never'}</b></div>
              <Note tone="info" icon={<IconShield size={14} />}>
                The sync passphrase is used to derive a hash on the Worker. It is never included in the GitHub Pages
                bundle, and local data is not uploaded until you connect.
              </Note>
            </Panel>

            <Panel title="Export & portability" sub="Your data is yours">
              <Button onClick={() => setTab('backup')}><IconDownload size={14} /> Open Data & Backup</Button>
              <p className="tiny dim" style={{ marginTop: 10 }}>
                Exports include photos and verification records. Restores validate schema and integrity before touching
                your local data.
              </p>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'goals' && goalForm && (
        <div className="settings-grid">
          <Panel title="Active targets" sub={`Effective from ${fmtDate(goalForm.effectiveFrom)}`}>
            <div className="form-grid">
              <Field label="Effective from"><input className="input" type="date" value={goalForm.effectiveFrom} onChange={(e) => setGoalForm({ ...goalForm, effectiveFrom: e.target.value })} /></Field>
              <Field label="Calories (kcal)"><input className="input" type="number" value={goalForm.calories} onChange={(e) => setGoalForm({ ...goalForm, calories: e.target.value })} /></Field>
              <Field label="Protein (g)"><input className="input" type="number" value={goalForm.protein} onChange={(e) => setGoalForm({ ...goalForm, protein: e.target.value })} /></Field>
              <Field label="Carbs (g)"><input className="input" type="number" value={goalForm.carbs} onChange={(e) => setGoalForm({ ...goalForm, carbs: e.target.value })} /></Field>
              <Field label="Fat (g)"><input className="input" type="number" value={goalForm.fat} onChange={(e) => setGoalForm({ ...goalForm, fat: e.target.value })} /></Field>
              <Field label="Water (ml)"><input className="input" type="number" value={goalForm.waterMl} onChange={(e) => setGoalForm({ ...goalForm, waterMl: e.target.value })} /></Field>
              <Field label="Qualifying step goal"><input className="input" type="number" value={goalForm.stepGoal} onChange={(e) => setGoalForm({ ...goalForm, stepGoal: e.target.value })} /></Field>
              <Field label="Treadmill min/week"><input className="input" type="number" value={goalForm.treadmillMinWeek} onChange={(e) => setGoalForm({ ...goalForm, treadmillMinWeek: e.target.value })} /></Field>
              <Field label="Target weight (kg)" hint="Reference line, not a deadline."><input className="input" type="number" step="0.1" value={goalForm.targetWeightKg} onChange={(e) => setGoalForm({ ...goalForm, targetWeightKg: e.target.value })} /></Field>
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
                    <tr key={g.id || g.effective_from}>
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
                A change applies from its effective date forward. Historical checkpoints keep the goal that was active on
                that day.
              </Note>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'cloud' && (
        <div className="settings-grid">
          <Panel title="Cloud sync" sub="Cloudflare Workers + D1 + R2">
            <div className="health-status-grid">
              <div>
                <span className="eyebrow">Connection</span>
                <div className="small" style={{ fontWeight: 600 }}>{cloudConnected ? 'Connected' : 'Not connected'}</div>
              </div>
              <div>
                <span className="eyebrow">Sync state</span>
                <span className="badge" data-tone={sync?.status === 'synced' ? 'verified' : sync?.status === 'error' ? 'review' : 'pending'}>
                  {sync?.status || 'idle'}
                </span>
              </div>
              <div>
                <span className="eyebrow">Queued changes</span>
                <div className="small" style={{ fontWeight: 600 }}>{sync?.pending || 0}</div>
              </div>
            </div>

            <div className="settings-kv" style={{ marginTop: 14 }}><span>API URL</span><b className="truncate">{localStorage.getItem('fos.apiUrl') || import.meta.env.VITE_API_URL || 'Not set'}</b></div>
            <div className="settings-kv"><span>Photo storage</span><b>{sync?.photoStorage === 'r2' ? 'Private R2' : 'This browser only (local-only)'}</b></div>
            <div className="settings-kv"><span>Last sync</span><b>{sync?.lastSync ? fmtDateTime(sync.lastSync) : 'Never'}</b></div>
            <div className="settings-kv"><span>Device ID</span><b className="mono tiny">{localStorage.getItem('fos.deviceId')?.slice(0, 18)}…</b></div>

            <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <Button variant={cloudConnected ? 'default' : 'primary'} onClick={() => setCloudModal(true)}>
                <IconCloud size={14} /> {cloudConnected ? 'Reconnect / change account' : 'Connect cloud account'}
              </Button>
              {cloudConnected && (
                <>
                  <Button onClick={async () => { await syncNow(); toast('Sync requested', 'success'); await refreshMe(); }}>
                    <IconRefreshCw size={14} /> Sync now
                  </Button>
                  <Button variant="ghost" onClick={disconnectCloud}>Disconnect</Button>
                </>
              )}
            </div>
            {sync?.error && <Note tone="danger" icon={<IconAlert size={14} />}>{sync.error}</Note>}
            <Note tone="info" icon={<IconInfo size={14} />}>
              Conflict resolution is per field, not blind last-write-wins. A stale offline edit cannot overwrite a newer
              field. Deletions are kept as tombstones.
            </Note>
            {sync?.photoStorage !== 'r2' && (
              <Note tone="warn" icon={<IconInfo size={14} />}>
                Cloud photo storage is off. Photo metadata syncs, but image files stay in this browser. Viewing a photo
                on a second device will show “Photo file is on another device” until R2 is enabled. Use
                Settings → Data & Backup to move photos with a backup file.
              </Note>
            )}
          </Panel>

          <div className="stack">
            <Panel title="Apple Health" sub="Automatic sync needs the iOS companion">
              <div className="health-status-grid">
                <div>
                  <span className="eyebrow">Last import</span>
                  <div className="small" style={{ fontWeight: 600 }}>{health?.freshness?.lastSync ? relativeTime(health.freshness.lastSync) : 'Never'}</div>
                </div>
                <div>
                  <span className="eyebrow">Status</span>
                  <StatusBadge status={health?.freshness?.stale ? 'pending_sync' : 'verified_device'} />
                </div>
                <div>
                  <span className="eyebrow">Devices</span>
                  <div className="small" style={{ fontWeight: 600 }}>{devices.filter((d) => !d.revoked).length}</div>
                </div>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <Button size="sm" onClick={() => healthInputRef.current?.click()} disabled={importingHealth}>
                  {importingHealth ? <span className="spinner" /> : <IconUpload size={14} />} Import Apple Health file
                </Button>
                <input ref={healthInputRef} type="file" accept=".json,.xml,application/json,text/xml" style={{ display: 'none' }} onChange={handleHealthImport} />
              </div>
              <p className="tiny dim" style={{ marginTop: 8 }}>
                Accepts the companion JSON snapshot or an Apple Health export.xml. Imports are validated, de-duplicated
                and attributed to treadmill intervals before they change your counters.
              </p>

              <div className="settings-subhead">Companion device tokens</div>
              {!cloudConnected && <div className="tiny dim">Connect a cloud account to create device tokens.</div>}
              {cloudConnected && (
                <>
                  <div className="token-list">
                    {devices.length === 0 && <div className="tiny dim">No companion registered yet.</div>}
                    {devices.map((d) => (
                      <div className="token-row" key={d.id}>
                        <IconWatch size={16} />
                        <div style={{ flex: 1 }}>
                          <div className="small">{d.name}</div>
                          <div className="tiny dim">
                            {d.revoked ? 'Revoked' : d.last_used_at ? `Last used ${relativeTime(d.last_used_at)}` : 'Never used'}
                          </div>
                        </div>
                        {!d.revoked && <button className="icon-btn" onClick={() => revokeDevice(d.id)} aria-label="Revoke"><IconTrash size={14} /></button>}
                      </div>
                    ))}
                  </div>
                  <Button size="sm" style={{ marginTop: 10 }} onClick={createDevice} disabled={busy}>
                    <IconPlus size={14} /> Create device token
                  </Button>
                  {newDeviceToken && (
                    <div className="new-token">
                      <div className="tiny dim" style={{ marginBottom: 4 }}>Copy this token now — it will not be shown again.</div>
                      <code>{newDeviceToken}</code>
                    </div>
                  )}
                </>
              )}
            </Panel>

            <Panel title="Background reality" sub="What iOS actually guarantees">
              <div className="stack" style={{ gap: 9 }}>
                <div className="guardrail-row"><IconCheck size={14} style={{ color: 'var(--lime)' }} /><span className="small muted">HealthKit background delivery can wake the companion after new samples.</span></div>
                <div className="guardrail-row"><IconCheck size={14} style={{ color: 'var(--lime)' }} /><span className="small muted">The companion keeps anchors and a persisted retry queue, so re-sends are idempotent.</span></div>
                <div className="guardrail-row"><IconAlert size={14} style={{ color: 'var(--amber)' }} /><span className="small muted">iOS does not guarantee real-time or immediate delivery. The UI shows “sync delayed” when imports are stale.</span></div>
                <div className="guardrail-row"><IconInfo size={14} style={{ color: 'var(--teal)' }} /><span className="small muted">A paid Apple Developer account and a physical device may be required for the companion. Build/signing cannot be verified from this workspace.</span></div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <div className="settings-grid">
          <Panel title="Export" sub="Complete copy, including photos">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => setBackupModal(true)}><IconDownload size={14} /> Create backup</Button>
              {cloudConnected && <Button onClick={exportCloud}><IconCloud size={14} /> Export cloud account</Button>}
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Backups include records, checkpoints, verification metadata and encrypted photo blobs. Encrypted backups
              use PBKDF2-SHA-256 and AES-GCM. The passphrase is never uploaded.
            </p>
            <Note tone="info" icon={<IconInfo size={14} />}>
              Photo files are stored in this browser only. A backup is the way to move them to another device while
              cloud photo storage is disabled. Metadata still syncs through D1.
            </Note>
            <div className="settings-subhead">CSV exports</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {[
                ['workouts', 'Workouts'],
                ['nutrition', 'Nutrition'],
                ['weight', 'Weight & waist'],
              ].map(([kind, label]) => (
                <Button key={kind} size="sm" onClick={async () => {
                  try {
                    const csv = await exportCsv(kind);
                    downloadText(csv.filename, csv.content, 'text/csv');
                    toast(`${label} CSV downloaded`, 'success');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                }}><IconDownload size={13} /> {label}</Button>
              ))}
            </div>
          </Panel>

          <div className="stack">
            <Panel title="Restore" sub="Validate before import">
              <Button onClick={() => setRestoreModal(true)}><IconUpload size={14} /> Restore from backup</Button>
              <p className="tiny dim" style={{ marginTop: 10 }}>
                The file is parsed and integrity-checked first. Merge keeps existing records and skips duplicates;
                replace clears local records first.
              </p>
              <div className="settings-subhead">Legacy SQLite export</div>
              <Button size="sm" onClick={() => legacyInputRef.current?.click()} disabled={busy}><IconUpload size={13} /> Import legacy JSON</Button>
              <input ref={legacyInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleLegacyImport} />
              <p className="tiny dim" style={{ marginTop: 8 }}>
                Import the JSON from the old Node API. Photos are not in that export and must be re-added.
              </p>
            </Panel>

            <Panel title="Danger zone" sub="Irreversible actions">
              <div className="stack" style={{ gap: 8 }}>
                <Button variant="danger" onClick={() => { setDeleteConfirm(''); setDeleteLocalOpen(true); }}><IconTrash size={14} /> Delete all local data</Button>
                {cloudConnected && <Button variant="danger" onClick={() => { setDeleteConfirm(''); setDeletePassphrase(''); setDeleteCloudOpen(true); }}><IconTrash size={14} /> Delete cloud account</Button>}
              </div>
              <Note tone="warn" icon={<IconAlert size={14} />}>
                Deleting local data removes IndexedDB and cached photos on this device. Cloud records are separate.
              </Note>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="settings-grid">
          <Panel title="Nightly closeout" sub="Cloudflare Cron · 25 18 * * * UTC">
            <div className="settings-kv"><span>Scheduled time</span><b>11:55 PM Asia/Kolkata</b></div>
            <div className="settings-kv"><span>Server next run</span><b>{jobs?.nextRun ? fmtDateTime(jobs.nextRun) : 'Connect cloud to view'}</b></div>
            <div className="settings-kv"><span>Local fallback next</span><b>{localJobs?.next ? fmtDateTime(localJobs.next) : '—'}</b></div>
            <div className="settings-kv"><span>Local checkpoints</span><b>{localJobs?.count ?? 0}</b></div>
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <Button size="sm" onClick={runCloseout} disabled={busy}><IconRefreshCw size={14} /> Run closeout now</Button>
            </div>
            <Note tone="info" icon={<IconInfo size={14} />}>
              The cron job runs whether or not this website is open. While the app is open near 11:55 PM, it also creates
              a local fallback checkpoint; the two are reconciled idempotently. Snapshots are never rewritten — late
              records are appended as a reconciliation.
            </Note>
          </Panel>

          <Panel title="Server runs" sub="Scheduled and manual executions" flush>
            {!cloudConnected ? (
              <Empty icon={<IconCloud size={20} />} title="Cloud not connected">
                Connect Cloud sync to inspect cron history. Local checkpoints remain available offline.
              </Empty>
            ) : !jobs?.runs?.length ? (
              <Empty icon={<IconClock size={20} />} title="No server runs yet" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Scheduled for</th><th>Started</th><th>Status</th><th>Users</th><th>Detail</th></tr></thead>
                  <tbody>
                    {jobs.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="tiny mono">{fmtDateTime(r.scheduled_for)}</td>
                        <td className="tiny">{fmtDateTime(r.started_at)}</td>
                        <td><StatusBadge status={r.status === 'ok' ? 'verified_device' : r.status === 'running' ? 'pending_sync' : 'needs_review'} short /></td>
                        <td className="mono">{r.users_processed}</td>
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

      {tab === 'audit' && (
        <Panel title="Audit history" sub="Local edits and cloud security events" flush>
          {auditRows.length === 0 ? (
            <Empty title="No audit entries yet">Creating a meal, weigh-in or settings change will appear here.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Source</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
                <tbody>
                  {auditRows.slice(0, 150).map((r, i) => (
                    <tr key={r.id || i}>
                      <td className="tiny">{fmtDateTime(r.at)}</td>
                      <td className="tiny dim">{r.source || 'local'}</td>
                      <td><span className="badge" data-tone="logged">{r.action}</span></td>
                      <td className="tiny">{r.entity || '—'}</td>
                      <td className="tiny dim truncate" style={{ maxWidth: 420 }}>{typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Modal open={cloudModal} onClose={() => setCloudModal(false)} title="Connect cloud sync" sub="Cloudflare Worker URL and passphrase. The passphrase is never stored in the bundle.">
        <form onSubmit={submitCloud} className="stack" style={{ gap: 13 }}>
          <Field label="Worker URL"><input className="input" value={cloudForm.apiUrl} onChange={(e) => setCloudForm({ ...cloudForm, apiUrl: e.target.value })} placeholder="https://…workers.dev" required /></Field>
          <Field label="Sync passphrase"><input className="input" type="password" value={cloudForm.passphrase} onChange={(e) => setCloudForm({ ...cloudForm, passphrase: e.target.value })} autoComplete="current-password" required /></Field>
          <Field label="Setup token" hint="Only needed if this is the first account on the Worker."><input className="input" value={cloudForm.setupToken} onChange={(e) => setCloudForm({ ...cloudForm, setupToken: e.target.value })} /></Field>
          <Note tone="info" icon={<IconLock size={14} />}>
            If the account already exists, the setup token is ignored. Existing local records are pushed after login.
          </Note>
          <div className="form-actions">
            <Button variant="ghost" type="button" onClick={() => setCloudModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : 'Connect & sync'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={backupModal} onClose={() => setBackupModal(false)} title="Create backup" sub="Download a complete copy of this device's records and photos.">
        <div className="stack" style={{ gap: 13 }}>
          <label className="checkbox">
            <input type="checkbox" checked={backupForm.encrypt} onChange={(e) => setBackupForm({ ...backupForm, encrypt: e.target.checked })} />
            Encrypt with a passphrase (recommended)
          </label>
          {backupForm.encrypt && (
            <>
              <Field label="Backup passphrase" hint="At least 12 characters. If lost, the backup cannot be recovered."><input className="input" type="password" value={backupForm.passphrase} onChange={(e) => setBackupForm({ ...backupForm, passphrase: e.target.value })} /></Field>
              <Field label="Confirm passphrase"><input className="input" type="password" value={backupForm.confirm} onChange={(e) => setBackupForm({ ...backupForm, confirm: e.target.value })} /></Field>
            </>
          )}
          {!backupForm.encrypt && (
            <Note tone="warn" icon={<IconAlert size={14} />}>
              An unencrypted backup contains private fitness and photo data. Store it somewhere you control.
            </Note>
          )}
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setBackupModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={exportBackup} disabled={busy}>Download backup</Button>
          </div>
        </div>
      </Modal>

      <Modal open={restoreModal} onClose={() => { setRestoreModal(false); setRestorePreview(null); }} title="Restore from backup" sub="Validate the file before it touches local data.">
        <div className="stack" style={{ gap: 13 }}>
          <Field label="Backup file"><input className="input" type="file" accept=".json,application/json" onChange={(e) => { setRestoreFile(e.target.files?.[0] || null); setRestorePreview(null); }} /></Field>
          <Field label="Backup passphrase" hint="Leave blank for an unencrypted backup."><input className="input" type="password" value={restorePassphrase} onChange={(e) => setRestorePassphrase(e.target.value)} /></Field>
          <div className="row" style={{ gap: 8 }}>
            <Button onClick={inspectRestore} disabled={!restoreFile || busy}>Inspect backup</Button>
            {restorePreview && <span className="badge" data-tone="verified"><IconCheck size={12} /> {restorePreview.records.length} records · {restorePreview.photos.length} photos</span>}
          </div>
          {restorePreview && (
            <>
              <div className="segmented" style={{ width: '100%' }}>
                <button type="button" aria-pressed={restoreMode === 'merge'} onClick={() => setRestoreMode('merge')} style={{ flex: 1 }}>Merge (keep existing)</button>
                <button type="button" aria-pressed={restoreMode === 'replace'} onClick={() => setRestoreMode('replace')} style={{ flex: 1 }}>Replace local data</button>
              </div>
              {restoreMode === 'replace' && <Note tone="danger" icon={<IconAlert size={14} />}>Replace clears local records and photos first. Cloud records are not deleted.</Note>}
            </>
          )}
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setRestoreModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={applyRestore} disabled={!restorePreview || busy}>Restore</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteLocalOpen} onClose={() => setDeleteLocalOpen(false)} title="Delete all local data?" sub="This cannot be undone. Cloud records are separate.">
        <div className="stack" style={{ gap: 13 }}>
          <Note tone="danger" icon={<IconAlert size={14} />}>This removes IndexedDB records, cached photos and the local sync queue on this device.</Note>
          <Field label='Type DELETE to confirm'><input className="input" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" /></Field>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setDeleteLocalOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={doDeleteLocal} disabled={deleteConfirm !== 'DELETE'}>Delete local data</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteCloudOpen} onClose={() => setDeleteCloudOpen(false)} title="Delete cloud account?" sub="Removes D1 records, R2 photos, sessions and device tokens.">
        <div className="stack" style={{ gap: 13 }}>
          <Note tone="danger" icon={<IconAlert size={14} />}>Download a backup first. This cannot be undone.</Note>
          <Field label="Sync passphrase"><input className="input" type="password" value={deletePassphrase} onChange={(e) => setDeletePassphrase(e.target.value)} /></Field>
          <Field label='Type DELETE to confirm'><input className="input" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" /></Field>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setDeleteCloudOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={doDeleteCloud} disabled={deleteConfirm !== 'DELETE' || !deletePassphrase || busy}>Delete cloud account</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function IconClock(props) {
  return (
    <svg width={props.size || 18} height={props.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
