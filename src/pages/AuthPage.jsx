import React, { useState } from 'react';
import { useApp } from '../state.jsx';
import { Button, Field } from '../components/ui.jsx';
import { IconShield, IconTreadmill, IconChart, IconCamera } from '../components/icons.jsx';

export default function AuthPage() {
  const { login, register } = useApp();
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    startDate: '2026-10-19',
    heightCm: 183,
    waistCm: 91.4,
    calories: 2400,
    protein: 175,
    stepGoal: 10000,
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
      } else {
        await register({
          email: form.email.trim(),
          password: form.password,
          name: form.name.trim(),
          startDate: form.startDate,
          heightCm: Number(form.heightCm),
          waistCm: Number(form.waistCm),
          calories: Number(form.calories),
          protein: Number(form.protein),
          stepGoal: Number(form.stepGoal),
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      await login('demo@fitness.local', 'demo12345');
    } catch (err) {
      setError(
        err.status === 401
          ? 'Demo account is not seeded yet. Run `npm run seed:demo` in the project root.'
          : err.message
      );
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
          <p className="muted" style={{ maxWidth: '46ch', marginTop: 18, fontSize: 14 }}>
            A private operating system for the October 19 → December 1 block. Treadmill work, steps,
            nutrition, strength and recovery — measured honestly, with every number labelled by how it
            was actually obtained.
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
              <span className="auth-feature-icon"><IconCamera size={18} /></span>
              <div>
                <div className="auth-feature-title">Private by design</div>
                <div className="auth-feature-copy">Progress photos stay on your machine, behind your login.</div>
              </div>
            </div>
          </div>

          <p className="tiny dim" style={{ marginTop: 36, maxWidth: '50ch' }}>
            Not medical advice. This tool will not recommend crash dieting, dehydration or punishing
            cardio volume.
          </p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <div className="segmented" style={{ width: '100%', marginBottom: 22 }}>
            <button
              type="button"
              aria-pressed={mode === 'login'}
              onClick={() => setMode('login')}
              style={{ flex: 1 }}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === 'register'}
              onClick={() => setMode('register')}
              style={{ flex: 1 }}
            >
              Create account
            </button>
          </div>

          <h2 className="section-title" style={{ fontSize: 21, marginBottom: 6 }}>
            {mode === 'login' ? 'Welcome back' : 'Set up your block'}
          </h2>
          <p className="small muted" style={{ marginBottom: 22 }}>
            {mode === 'login'
              ? 'Your data never leaves this machine.'
              : 'These become your starting goals. You can change any of them later.'}
          </p>

          <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
            {mode === 'register' && (
              <Field label="Name">
                <input className="input" value={form.name} onChange={set('name')} required autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={set('email')}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={set('password')}
                required
                minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </Field>

            {mode === 'register' && (
              <div className="form-grid">
                <Field label="Start date">
                  <input className="input" type="date" value={form.startDate} onChange={set('startDate')} />
                </Field>
                <Field label="Height (cm)">
                  <input className="input" type="number" value={form.heightCm} onChange={set('heightCm')} />
                </Field>
                <Field label="Waist (cm)">
                  <input className="input" type="number" step="0.1" value={form.waistCm} onChange={set('waistCm')} />
                </Field>
                <Field label="Calories">
                  <input className="input" type="number" value={form.calories} onChange={set('calories')} />
                </Field>
                <Field label="Protein (g)">
                  <input className="input" type="number" value={form.protein} onChange={set('protein')} />
                </Field>
                <Field label="Step goal">
                  <input className="input" type="number" value={form.stepGoal} onChange={set('stepGoal')} />
                </Field>
              </div>
            )}

            {error && (
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
                {error}
              </div>
            )}

            <Button variant="primary" size="lg" type="submit" disabled={busy} style={{ width: '100%', marginTop: 4 }}>
              {busy ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
            <hr className="divider" style={{ flex: 1 }} />
            <span className="tiny dim">or</span>
            <hr className="divider" style={{ flex: 1 }} />
          </div>

          <Button variant="ghost" onClick={useDemo} disabled={busy} style={{ width: '100%' }}>
            Explore with sample data
          </Button>
          <p className="tiny dim" style={{ marginTop: 10, textAlign: 'center' }}>
            Opens a separate demo account. Synthetic data is labelled everywhere.
          </p>
        </div>
      </div>
    </div>
  );
}
