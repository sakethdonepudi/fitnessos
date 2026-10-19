import React, { useId, useMemo, useRef, useState } from 'react';

function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min, min + 1];
  }
  const span = max - min;
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/* ---------------------------------------------------------------- */
/* Line chart with optional band, dots and hover                     */
/* ---------------------------------------------------------------- */

export function LineChart({
  series,
  height = 220,
  yLabel,
  yFormat = (v) => v,
  xFormat = (d) => d,
  band,
  bandLabel,
  referenceLine,
  referenceLabel,
  showArea = true,
  yDomain,
  minPoints = 2,
}) {
  const uid = useId().replace(/[:]/g, '');
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const pad = { top: 14, right: 14, bottom: 26, left: 42 };

  const allValues = useMemo(() => {
    const values = [];
    for (const s of series) for (const p of s.points) if (p.y != null) values.push(p.y);
    if (band) values.push(band.low, band.high);
    if (referenceLine != null) values.push(referenceLine);
    return values.filter((v) => Number.isFinite(v));
  }, [series, band, referenceLine]);

  const n = Math.max(...series.map((s) => s.points.length), 0);
  if (n < minPoints || allValues.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
          fontSize: 12,
          border: '1px dashed var(--line)',
          borderRadius: 12,
        }}
      >
        Not enough data yet
      </div>
    );
  }

  const rawMin = yDomain?.[0] ?? Math.min(...allValues);
  const rawMax = yDomain?.[1] ?? Math.max(...allValues);
  const spanPad = (rawMax - rawMin) * 0.12 || 1;
  const ticks = niceTicks(rawMin - spanPad, rawMax + spanPad, 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const innerW = 100;
  const innerH = height - pad.top - pad.bottom;
  const xAt = (i) => pad.left + (i / Math.max(1, n - 1)) * (600 - pad.left - pad.right);
  const yAt = (v) => pad.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const viewW = 600;
  const viewH = height;

  const pathFor = (points, key) => {
    let d = '';
    let started = false;
    points.forEach((p, i) => {
      if (p[key] == null) {
        started = false;
        return;
      }
      const x = pad.left + (i / Math.max(1, n - 1)) * (viewW - pad.left - pad.right);
      const y = yAt(p[key]);
      d += `${started ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const areaFor = (points, key) => {
    const d = pathFor(points, key);
    if (!d) return '';
    const lastIdx = points.length - 1;
    const lastX = pad.left + (lastIdx / Math.max(1, n - 1)) * (viewW - pad.left - pad.right);
    const firstX = pad.left;
    return `${d} L${lastX.toFixed(1)},${viewH - pad.bottom} L${firstX.toFixed(1)},${viewH - pad.bottom} Z`;
  };

  const bandPath = () => {
    if (!band) return '';
    const top = band.high.map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad.left + (i / Math.max(1, n - 1)) * (viewW - pad.left - pad.right)).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    const bottom = [...band.low]
      .reverse()
      .map((v, ri) => {
        const i = band.low.length - 1 - ri;
        return `L${(pad.left + (i / Math.max(1, n - 1)) * (viewW - pad.left - pad.right)).toFixed(1)},${yAt(v).toFixed(1)}`;
      })
      .join(' ');
    return `${top} ${bottom} Z`;
  };

  const handleMove = (e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = (e.clientX - rect.left) / rect.width;
    const innerFrac = (rel * viewW - pad.left) / (viewW - pad.left - pad.right);
    const idx = Math.round(innerFrac * (n - 1));
    if (idx < 0 || idx >= n) return setHover(null);
    setHover({ idx, left: rel * 100 });
  };

  const primary = series[0];
  const hoverPoint = hover != null ? primary.points[hover.idx] : null;

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="none"
        style={{ height, width: '100%' }}
        role="img"
        aria-label={yLabel || 'Chart'}
      >
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="chart-grid">
          {ticks.map((t) => (
            <line key={t} x1={pad.left} x2={viewW - pad.right} y1={yAt(t)} y2={yAt(t)} />
          ))}
        </g>

        {ticks.map((t) => (
          <text key={`lbl-${t}`} className="chart-axis-label" x={pad.left - 8} y={yAt(t) + 3} textAnchor="end">
            {yFormat(t)}
          </text>
        ))}

        {referenceLine != null && (
          <g>
            <line
              x1={pad.left}
              x2={viewW - pad.right}
              y1={yAt(referenceLine)}
              y2={yAt(referenceLine)}
              stroke="var(--teal)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.6"
            />
            {referenceLabel && (
              <text
                x={viewW - pad.right}
                y={yAt(referenceLine) - 5}
                textAnchor="end"
                className="chart-axis-label"
                fill="var(--teal)"
              >
                {referenceLabel}
              </text>
            )}
          </g>
        )}

        {band && <path d={bandPath()} fill="rgba(198,255,74,0.08)" stroke="none" />}

        {showArea && primary && (
          <path d={areaFor(primary.points, 'y')} fill={`url(#area-${uid})`} />
        )}

        {series.map((s) => (
          <path
            key={s.key || s.label}
            d={pathFor(s.points, 'y')}
            fill="none"
            stroke={s.color || 'var(--lime)'}
            strokeWidth={s.width || 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? '5 5' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {series.map((s) =>
          s.points.map((p, i) =>
            p.y == null || !s.dots ? null : (
              <circle
                key={`${s.label}-${i}`}
                cx={pad.left + (i / Math.max(1, n - 1)) * (viewW - pad.left - pad.right)}
                cy={yAt(p.y)}
                r="2.6"
                fill={s.color || 'var(--lime)'}
                stroke="#0a0c10"
                strokeWidth="1.2"
              />
            )
          )
        )}

        {hover != null && (
          <line
            x1={pad.left + (hover.idx / Math.max(1, n - 1)) * (viewW - pad.left - pad.right)}
            x2={pad.left + (hover.idx / Math.max(1, n - 1)) * (viewW - pad.left - pad.right)}
            y1={pad.top}
            y2={viewH - pad.bottom}
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {primary &&
          [0, Math.floor((n - 1) / 2), n - 1].map((i, k) => {
            const p = primary.points[i];
            if (!p) return null;
            return (
              <text
                key={`x-${k}`}
                className="chart-axis-label"
                x={pad.left + (i / Math.max(1, n - 1)) * (viewW - pad.left - pad.right)}
                y={viewH - 8}
                textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
              >
                {xFormat(p.x)}
              </text>
            );
          })}
      </svg>

      {hover != null && hoverPoint && (
        <div className="chart-tooltip" style={{ left: `${hover.left}%`, top: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>{xFormat(hoverPoint.x)}</div>
          {series.map((s) => {
            const p = s.points[hover.idx];
            if (!p || p.y == null) return null;
            return (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className="legend-swatch"
                  style={{ background: s.color || 'var(--lime)' }}
                />
                <span className="muted">{s.label}</span>
                <span className="mono" style={{ marginLeft: 'auto' }}>
                  {yFormat(p.y)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {bandLabel && (
        <div className="tiny dim" style={{ marginTop: 6 }}>
          {bandLabel}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Multi-ring activity cluster (Apple Fitness style)                 */
/* ---------------------------------------------------------------- */

export function ActivityRings({ rings, size = 180, stroke = 13, gap = 5 }) {
  const center = size / 2;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        {rings.map((ring, i) => {
          const r = center - stroke / 2 - i * (stroke + gap);
          const c = 2 * Math.PI * r;
          const pct = ring.max > 0 ? Math.min(1, Math.max(0, ring.value / ring.max)) : 0;
          return (
            <g key={ring.label}>
              <circle cx={center} cy={center} r={r} fill="none" stroke={ring.track || 'rgba(255,255,255,0.07)'} strokeWidth={stroke} />
              <circle
                cx={center}
                cy={center}
                r={r}
                fill="none"
                stroke={ring.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - pct)}
                style={{ transition: 'stroke-dashoffset 1s var(--ease)' }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Bar chart                                                         */
/* ---------------------------------------------------------------- */

export function BarChart({
  data,
  height = 130,
  color = 'var(--lime)',
  secondaryColor = 'rgba(255,255,255,0.12)',
  format = (v) => v,
  goal,
  label,
}) {
  const max = Math.max(goal || 0, ...data.map((d) => d.value || 0), 1);
  return (
    <div>
      <div style={{ position: 'relative', height }}>
        {goal != null && (
          <div
            className="bar-goal-line"
            style={{ bottom: `${(goal / max) * 100}%` }}
            title={`Goal: ${format(goal)}`}
          />
        )}
        <div className="bar-chart" style={{ height }} role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = d.value == null ? 0 : Math.max(2, (d.value / max) * 100);
          const secH = d.secondary == null ? 0 : Math.max(0, (d.secondary / max) * 100);
          const met = goal != null && d.value != null && d.value >= goal;
          return (
            <div className="bar-col" key={d.key ?? i} title={`${d.tooltip ?? d.label}: ${format(d.value)}`}>
              <div
                className="bar-col-fill"
                style={{
                  height: `${h}%`,
                  background:
                    d.value == null
                      ? secondaryColor
                      : met
                        ? color
                        : `color-mix(in srgb, ${color} 62%, transparent)`,
                  opacity: d.value == null ? 0.4 : 1,
                }}
              />
            </div>
          );
        })}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {data.map((d, i) => (
          <div
            key={`lbl-${d.key ?? i}`}
            className="tiny dim"
            style={{ flex: 1, textAlign: 'center', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {d.shortLabel ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Stacked horizontal bars (macros)                                  */
/* ---------------------------------------------------------------- */

export function MacroBar({ protein, carbs, fat }) {
  const pCal = protein * 4;
  const cCal = carbs * 4;
  const fCal = fat * 9;
  const total = pCal + cCal + fCal || 1;
  const segments = [
    { label: 'Protein', value: pCal, color: 'var(--lime)' },
    { label: 'Carbs', value: cCal, color: 'var(--teal)' },
    { label: 'Fat', value: fCal, color: 'var(--violet)' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
        {segments.map((s) => (
          <div
            key={s.label}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.color,
              borderRadius: 999,
              transition: 'width 0.6s var(--ease)',
            }}
          />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {segments.map((s) => (
          <span className="legend-item" key={s.label}>
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.label}
            <span className="mono dim">{Math.round(s.value)} kcal</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Heart-rate zone strip                                             */
/* ---------------------------------------------------------------- */

export function HrZones({ avgHr, maxHr, age = 24 }) {
  const maxHrEst = 220 - age;
  const zones = [
    { name: 'Z1', label: 'Very light', low: 0.5, high: 0.6, color: 'rgba(94,234,212,0.55)' },
    { name: 'Z2', label: 'Light', low: 0.6, high: 0.7, color: 'rgba(198,255,74,0.65)' },
    { name: 'Z3', label: 'Moderate', low: 0.7, high: 0.8, color: 'rgba(251,191,36,0.7)' },
    { name: 'Z4', label: 'Hard', low: 0.8, high: 0.9, color: 'rgba(255,143,64,0.75)' },
    { name: 'Z5', label: 'Maximum', low: 0.9, high: 1.0, color: 'rgba(255,107,107,0.8)' },
  ];
  const hr = avgHr ?? null;
  const pctOfMax = hr != null ? hr / maxHrEst : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 3, height: 26, alignItems: 'stretch' }}>
        {zones.map((z) => {
          const active = pctOfMax != null && pctOfMax >= z.low && pctOfMax < z.high;
          return (
            <div
              key={z.name}
              title={`${z.name} ${z.label} · ${Math.round(z.low * maxHrEst)}–${Math.round(z.high * maxHrEst)} bpm`}
              style={{
                flex: z.high - z.low,
                background: z.color,
                opacity: pctOfMax == null ? 0.28 : active ? 1 : 0.26,
                borderRadius: 5,
                transition: 'opacity 0.3s, transform 0.3s',
                transform: active ? 'scaleY(1.14)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: '#08090c',
              }}
            >
              {z.name}
            </div>
          );
        })}
      </div>
      <div className="tiny dim" style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>
          {hr != null ? `Avg ${Math.round(hr)} bpm` : 'No heart-rate data'}
          {maxHr != null ? ` · peak ${Math.round(maxHr)}` : ''}
        </span>
        <span>Est. max {maxHrEst} bpm</span>
      </div>
      <p className="tiny dim" style={{ marginTop: 4 }}>
        Zones are estimates from age-predicted max heart rate. They describe effort, not fat-burning magic.
      </p>
    </div>
  );
}
