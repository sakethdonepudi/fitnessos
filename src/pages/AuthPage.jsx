import React, { useState } from 'react';
import { useApp } from '../state.jsx';
import { getApiBase } from '../data/remote.js';
import { Button, Field, Note } from '../components/ui.jsx';
import { IconShield, IconTreadmill, IconChart, IconCloud, IconLock, IconInfo } from '../components/icons.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function AuthPage() {
  const { createProfile, loginCloud, toast } = useApp();
  const [mode, setMode] = useState('create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [form, setForm] = useState({
    name: '',
    startDate: '2026-10-19',
    checkpointDate: '2026-12-01',
    heightCm: 183,
    waistCm: 91.44,
    calories: 2400,
    protein: 175,
    waterMl: 3250,
    stepGoal: 10000,
    targetWeightKg: 84,
    apiUrl: getApiBase(),
    passphrase: '',
    setupToken: '',
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submitCreate = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('Give your profile a name.');
    if (cloudEnabled && (!form.apiUrl.trim() || !form.passphrase)) {
      return setError('Enter the Worker URL and a sync passphrase, or turn cloud sync off.');
    }
    setBusy(true);
    try {
      await createProfile(
        {
          name: form.name.trim(),
          startDate: form.startDate,
          checkpointDate: form.checkpointDate,
          heightCm: form.heightCm,
          waistCm: form.waistCm,
          calories: form.calories,
          protein: form.protein,
          waterMl: form.waterMl,
          stepGoal: form.stepGoal,
          targetWeightKg: form.targetWeightKg,
        },
        cloudEnabled
          ? { apiUrl: form.apiUrl, passphrase: form.passphrase, setupToken: form.setupToken || null }
          : null
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.apiUrl.trim() || !form.passphrase) return setError('Enter the Worker URL and your sync passphrase.');
    setBusy(true);
    try {
      const result = await loginCloud({ apiUrl: form.apiUrl, passphrase: form.passphrase });
      if (result.needsProfile) {
        toast('Connected. Create your profile to finish setup.', 'success');
        setMode('create');
        setCloudEnabled(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-hero">
        <div className="auth-hero-inner">
          <div className="brand" style={{ fontSize: 15, marginBottom: 40 }}>
            <span className="brand-mark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19 10 5l6 14" />
                <path d="M16 19 20 5" />
              </svg>
            </span>
            <span>
              FITNESS<span style={{ color: 'var(--lime)' }}>OS</span>
            </span>
          </div>

          <h1 className="display" style={{ fontSize: 'clamp(38px, 5vw, 62px)', maxWidth: '13ch' }}>
            Train the
            <br />
            <span style={{ color: 'var(--lime)' }}>long game.</span>
          </h1>
          <p className="muted" style={{ maxWidth: '48ch', marginTop: 18, fontSize: 14 }}>
            A private operating system for the October 19 → December 1 block. Local-first on this device, with optional
            encrypted cloud sync across your iPhone and Mac.
          </p>

          <div className="auth-features">
            <div className="auth-feature">
              <span className="auth-feature-icon"><IconTreadmill size={18} /></span>
              <div>
                <div className="auth-feature-title">Treadmill, separated</div>
                <div className="auth-feature-copy">Indoor walks tracked apart from your 10,000-step walking goal.</div>
              </div>
            </div>
            <div className="auth-feature">
              <span className="auth-feature-icon"><IconShield size={18} /></span>
              <div>
                <div className="auth-feature-title">Evidence, not vibes</div>
                <div className="auth-feature-copy">Device-verified, user-logged and estimated are never blurred together.</div>
              </div>
            </div>
            <div className="auth-feature">
              <span className="auth-feature-icon"><IconChart size={18} /></span>
              <div>
                <div className="auth-feature-title">Ranges, not promises</div>
                <div className="auth-feature-copy">December 1 is a checkpoint. Projections are ranges with stated confidence.</div>
              </div>
            </div>
            <div className="auth-feature">
              <span className="auth-feature-icon"><IconCloud size={18} /></span>
              <div>
                <div className="auth-feature-title">Optional cloud sync</div>
                <div className="auth-feature-copy">Cloudflare Workers + D1 keep devices aligned. The app still works offline.</div>
              </div>
            </div>
          </div>

          <p className="tiny dim" style={{ marginTop: 36, maxWidth: '50ch' }}>
            Not medical advice. This tool will not recommend crash dieting, dehydration or punishing cardio volume.
          </p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <div className="segmented" style={{ width: '100%', marginBottom: 22 }}>
            <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')} style={{ flex: 1 }}>
              Create profile
            </button>
            <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')} style={{ flex: 1 }}>
              Connect account
            </button>
          </div>

          <h2 className="section-title" style={{ fontSize: 21, marginBottom: 6 }}>
            {mode === 'create' ? 'Set up your block' : 'Sign in to sync'}
          </h2>
          <p className="small muted" style={{ marginBottom: 20 }}>
            {mode === 'create'
              ? 'Your data stays on this device. Cloud sync is optional and can be added later.'
              : 'Pull your records from Cloudflare D1 onto this device.'}
          </p>

          {mode === 'create' ? (
            <form onSubmit={submitCreate} className="stack" style={{ gap: 13 }}>
              <Field label="Name">
                <input className="input" value={form.name} onChange={set('name')} required autoComplete="name" placeholder="Your name" />
              </Field>
              <div className="form-grid">
                <Field label="Start date"><input className="input" type="date" value={form.startDate} onChange={set('startDate')} /></Field>
                <Field label="Checkpoint"><input className="input" type="date" value={form.checkpointDate} onChange={set('checkpointDate')} /></Field>
                <Field label="Height (cm)"><input className="input" type="number" value={form.heightCm} onChange={set('heightCm')} /></Field>
                <Field label="Waist (cm)"><input className="input" type="number" step="0.1" value={form.waistCm} onChange={set('waistCm')} /></Field>
                <Field label="Calories"><input className="input" type="number" value={form.calories} onChange={set('calories')} /></Field>
                <Field label="Protein (g)"><input className="input" type="number" value={form.protein} onChange={set('protein')} /></Field>
                <Field label="Water (ml)"><input className="input" type="number" value={form.waterMl} onChange={set('waterMl')} /></Field>
                <Field label="Step goal"><input className="input" type="number" value={form.stepGoal} onChange={set('stepGoal')} /></Field>
                <Field label="Target weight (kg)"><input className="input" type="number" step="0.1" value={form.targetWeightKg} onChange={set('targetWeightKg')} /></Field>
              </div>

              <label className="checkbox" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={cloudEnabled} onChange={(e) => setCloudEnabled(e.target.checked)} />
                Add encrypted cloud sync across devices
              </label>

              {cloudEnabled && (
                <div className="stack" style={{ gap: 11, padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'rgba(0,0,0,0.2)' }}>
                  <Field label="Worker URL" hint="Example: https://fitnessos-api.your-subdomain.workers.dev">
                    <input className="input" value={form.apiUrl} onChange={set('apiUrl')} placeholder="https://…workers.dev" />
                  </Field>
                  <Field label="Sync passphrase" hint="At least 12 characters. Used for the cloud account, not stored in the bundle.">
                    <input className="input" type="password" value={form.passphrase} onChange={set('passphrase')} autoComplete="new-password" />
                  </Field>
                  <Field label="Setup token" hint="Only for the first account. From the Worker SETUP_TOKEN secret.">
                    <input className="input" value={form.setupToken} onChange={set('setupToken')} placeholder="Optional if the account already exists" />
                  </Field>
                  <div className="tiny dim" style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                    <IconLock size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    Cloud records are private to your account. Photos are stored in a private R2 bucket and served only
                    through authenticated requests.
                  </div>
                </div>
              )}

              {error && <ErrorBox message={error} />}
              <Button variant="primary" size="lg" type="submit" disabled={busy} style={{ width: '100%', marginTop: 4 }}>
                {busy ? <span className="spinner" /> : cloudEnabled ? 'Create profile & connect' : 'Create private profile'}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitLogin} className="stack" style={{ gap: 13 }}>
              <Field label="Worker URL" hint="Your deployed Cloudflare Worker base URL.">
                <input className="input" value={form.apiUrl} onChange={set('apiUrl')} placeholder="https://…workers.dev" required />
              </Field>
              <Field label="Sync passphrase">
                <input className="input" type="password" value={form.passphrase} onChange={set('passphrase')} autoComplete="current-password" required />
              </Field>
              {error && <ErrorBox message={error} />}
              <Button variant="primary" size="lg" type="submit" disabled={busy} style={{ width: '100%', marginTop: 4 }}>
                {busy ? <span className="spinner" /> : 'Sign in & pull records'}
              </Button>
              <Note tone="info" icon={<IconInfo size={14} />}>
                Signing in does not delete anything on this device. Incoming records are merged; conflicts are resolved
                per field and logged.
              </Note>
            </form>
          )}

          <p className="tiny dim" style={{ marginTop: 16, textAlign: 'center' }}>
            No account? Create a private local profile and add cloud sync later in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div
      className="small"
      style={{
        color: '#ffa3a3',
        background: 'rgba(255,107,107,0.09)',
        border: '1px solid rgba(255,107,107,0.24)',
        borderRadius: 10,
        padding: '9px 11px',
      }}
    >
      {message}
    </div>
  );
}
