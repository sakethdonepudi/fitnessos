import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './icons.jsx';

/* ---------------------------------------------------------------- */
/* Status badge                                                      */
/* ---------------------------------------------------------------- */

const STATUS_META = {
  verified_device: { label: 'Verified by device', short: 'Device', tone: 'verified' },
  logged_user: { label: 'Logged by user', short: 'Logged', tone: 'logged' },
  ai_estimated: { label: 'AI estimated', short: 'Estimated', tone: 'estimated' },
  pending_sync: { label: 'Pending sync', short: 'Pending', tone: 'pending' },
  needs_review: { label: 'Needs review', short: 'Review', tone: 'review' },
  not_recorded: { label: 'Not recorded', short: 'None', tone: 'empty' },
};

export function StatusBadge({ status, short = false, title }) {
  const meta = STATUS_META[status] || STATUS_META.not_recorded;
  return (
    <span
      className="badge"
      data-tone={meta.tone}
      title={title || meta.label}
    >
      <span className="badge-dot" />
      {short ? meta.short : meta.label}
    </span>
  );
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.not_recorded;
}

/* ---------------------------------------------------------------- */
/* Panel                                                             */
/* ---------------------------------------------------------------- */

export function Panel({ children, className = '', title, sub, action, flush = false, glass = false }) {
  return (
    <section className={`panel ${flush ? 'panel-flush' : ''} ${glass ? 'panel-glass' : ''} ${className}`}>
      {(title || action) && (
        <div className="panel-head" style={flush ? { padding: '18px 20px 0', marginBottom: 0 } : undefined}>
          <div>
            {title && <div className="panel-title">{title}</div>}
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Buttons                                                           */
/* ---------------------------------------------------------------- */

export function Button({ children, variant = 'default', size, className = '', ...props }) {
  const cls = [
    'btn',
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'ghost' ? 'btn-ghost' : '',
    variant === 'danger' ? 'btn-danger' : '',
    size === 'sm' ? 'btn-sm' : '',
    size === 'lg' ? 'btn-lg' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...props}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- */
/* Modal                                                             */
/* ---------------------------------------------------------------- */

export function Modal({ open, onClose, title, sub, children, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${wide ? 'modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <div>
            <h2 className="section-title">{title}</h2>
            {sub && <p className="small muted" style={{ marginTop: 4 }}>{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ---------------------------------------------------------------- */
/* Fields                                                            */
/* ---------------------------------------------------------------- */

export function Field({ label, hint, children, style }) {
  return (
    <div className="field" style={style}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="tiny dim">{hint}</span>}
    </div>
  );
}

export function Input({ label, hint, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <input className="input" {...props} />
    </Field>
  );
}

export function Select({ label, hint, children, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <select className="select" {...props}>
        {children}
      </select>
    </Field>
  );
}

export function Textarea({ label, hint, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <textarea className="textarea" {...props} />
    </Field>
  );
}

/* ---------------------------------------------------------------- */
/* Progress bar                                                      */
/* ---------------------------------------------------------------- */

export function ProgressBar({ value, max = 100, tone = '', height, label }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={`bar ${height === 'tall' ? 'bar-tall' : ''}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Ring                                                              */
/* ---------------------------------------------------------------- */

export function Ring({ value, max = 100, size = 92, stroke = 8, color = 'var(--lime)', children, trackColor }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const offset = circumference * (1 - pct);

  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          className="ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          stroke={trackColor || undefined}
        />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Empty state                                                       */
/* ---------------------------------------------------------------- */

export function Empty({ icon, title, children, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{title}</div>
      {children && <div className="small" style={{ maxWidth: '42ch' }}>{children}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Tabs                                                              */
/* ---------------------------------------------------------------- */

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className="tab"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null && <span className="dim" style={{ marginLeft: 6 }}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Segmented                                                         */
/* ---------------------------------------------------------------- */

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Metric                                                            */
/* ---------------------------------------------------------------- */

export function Metric({ label, value, unit, foot, accent, size }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div
        className="metric-value"
        style={{ color: accent, ...(size ? { fontSize: size } : {}) }}
      >
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {foot && <div className="metric-foot">{foot}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Disclosure / info note                                            */
/* ---------------------------------------------------------------- */

export function Note({ children, tone = 'info', icon }) {
  const colors = {
    info: { border: 'var(--line)', bg: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' },
    warn: { border: 'rgba(251,191,36,0.24)', bg: 'rgba(251,191,36,0.07)', color: '#fcd34d' },
    good: { border: 'rgba(198,255,74,0.22)', bg: 'rgba(198,255,74,0.06)', color: '#d4ff6e' },
    danger: { border: 'rgba(255,107,107,0.24)', bg: 'rgba(255,107,107,0.07)', color: '#ffa3a3' },
  }[tone];
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '11px 13px',
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.color,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {icon && <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Sparkline                                                         */
/* ---------------------------------------------------------------- */

export function Sparkline({ values, width = 120, height = 32, color = 'var(--lime)', fill = true }) {
  const clean = values.filter((v) => v != null && Number.isFinite(v));
  if (clean.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => (v == null ? null : [i * step, height - ((v - min) / span) * (height - 4) - 2]))
    .filter(Boolean);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  const id = `spark-${color.replace(/[^a-z0-9]/gi, '')}-${Math.round(width)}`;
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
