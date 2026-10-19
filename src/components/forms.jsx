import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Button, Field, Modal, Note } from './ui.jsx';
import { isoForZonedDateTime, timeInZone } from '../lib/format.js';

function defaultDate() {
  return new Date().toISOString().slice(0, 10);
}

export function WeighInModal({ open, onClose, onSaved, initial }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    date: initial?.date || defaultDate(),
    weightKg: initial?.weight_kg ?? '',
    waistCm: initial?.waist_cm ?? '',
    bodyFatPct: initial?.body_fat_pct ?? '',
    bodyFatSource: initial?.body_fat_source || 'estimate',
    note: initial?.note || '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        date: initial?.date || defaultDate(),
        weightKg: initial?.weight_kg ?? '',
        waistCm: initial?.waist_cm ?? '',
        bodyFatPct: initial?.body_fat_pct ?? '',
        bodyFatSource: initial?.body_fat_source || 'estimate',
        note: initial?.note || '',
      });
    }
  }, [open, initial]);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/weigh-ins', {
        date: form.date,
        weightKg: form.weightKg === '' ? null : Number(form.weightKg),
        waistCm: form.waistCm === '' ? null : Number(form.waistCm),
        bodyFatPct: form.bodyFatPct === '' ? null : Number(form.bodyFatPct),
        bodyFatSource: form.bodyFatSource,
        note: form.note || null,
      });
      toast('Weigh-in saved', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log body measurement" sub="One entry per day. Logging again updates that day.">
      <div className="form-grid">
        <Field label="Date">
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Weight (kg)">
          <input className="input" type="number" step="0.1" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} placeholder="e.g. 90.4" />
        </Field>
        <Field label="Waist (cm)">
          <input className="input" type="number" step="0.1" value={form.waistCm} onChange={(e) => setForm({ ...form, waistCm: e.target.value })} placeholder="optional" />
        </Field>
        <Field label="Body fat (%)">
          <input className="input" type="number" step="0.1" value={form.bodyFatPct} onChange={(e) => setForm({ ...form, bodyFatPct: e.target.value })} placeholder="optional" />
        </Field>
        <Field label="Body-fat source" hint="Never presented as clinically precise unless measured by a device.">
          <select className="select" value={form.bodyFatSource} onChange={(e) => setForm({ ...form, bodyFatSource: e.target.value })}>
            <option value="estimate">Estimated / visual</option>
            <option value="measured_scale">Smart scale measurement</option>
            <option value="dexa">DEXA scan</option>
          </select>
        </Field>
        <Field label="Note" style={{ gridColumn: '1 / -1' }}>
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Morning, fasted, after bathroom" />
        </Field>
      </div>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Save measurement</Button>
      </div>
    </Modal>
  );
}

export function MealModal({ open, onClose, onSaved, date }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ slot: 'lunch', name: '', calories: '', protein: '', carbs: '', fat: '', notes: '' });
  const [foods, setFoods] = useState([]);
  const [foodId, setFoodId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ slot: 'lunch', name: '', calories: '', protein: '', carbs: '', fat: '', notes: '' });
      setFoodId('');
      api.get('/foods').then((res) => setFoods(res.foods || [])).catch(() => {});
    }
  }, [open]);

  const chooseFood = (id) => {
    setFoodId(id);
    const food = foods.find((f) => f.id === id);
    if (!food) return;
    setForm((f) => ({
      ...f,
      name: food.name,
      calories: String(food.calories),
      protein: String(food.protein_g),
      carbs: String(food.carbs_g),
      fat: String(food.fat_g),
      notes: `Food library · ${food.serving}`,
    }));
  };

  const save = async () => {
    if (!form.name.trim()) return toast('Give the meal a name', 'error');
    setBusy(true);
    try {
      await api.post('/meals', {
        date: date || defaultDate(),
        slot: form.slot,
        name: form.name,
        calories: Number(form.calories) || 0,
        protein: Number(form.protein) || 0,
        carbs: Number(form.carbs) || 0,
        fat: Number(form.fat) || 0,
        notes: form.notes || null,
      });
      toast('Meal logged', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log a meal" sub="Values are user-reported estimates unless you attach a label or photo.">
      <div className="form-grid">
        <Field label="Quick add from food library" style={{ gridColumn: '1 / -1' }} hint="Selecting a food fills the macros; you can still edit them.">
          <select className="select" value={foodId} onChange={(e) => chooseFood(e.target.value)}>
            <option value="">Choose a saved food…</option>
            {foods.map((f) => (
              <option key={f.id} value={f.id}>{f.name} · {f.serving} · {f.calories} kcal</option>
            ))}
          </select>
        </Field>
        <Field label="Meal">
          <select className="select" value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })}>
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
            <option value="meal">Other</option>
          </select>
        </Field>
        <Field label="Name">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chicken rice bowl" />
        </Field>
        <Field label="Calories">
          <input className="input" type="number" value={form.calories} onChange={(e) => setForm({ ...form, calories: e.target.value })} placeholder="650" />
        </Field>
        <Field label="Protein (g)">
          <input className="input" type="number" value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })} placeholder="55" />
        </Field>
        <Field label="Carbs (g)">
          <input className="input" type="number" value={form.carbs} onChange={(e) => setForm({ ...form, carbs: e.target.value })} placeholder="70" />
        </Field>
        <Field label="Fat (g)">
          <input className="input" type="number" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })} placeholder="18" />
        </Field>
        <Field label="Notes" style={{ gridColumn: '1 / -1' }}>
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Weighed raw, 180 g chicken" />
        </Field>
      </div>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Log meal</Button>
      </div>
    </Modal>
  );
}

export function WaterModal({ open, onClose, onSaved, date }) {
  const { toast } = useApp();
  const [ml, setMl] = useState(500);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/water', { ml, date: date || defaultDate() });
      toast(`${ml} ml logged`, 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add water" sub="Water is always self-reported.">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {[250, 330, 500, 750, 1000].map((amount) => (
          <button
            key={amount}
            className={`chip ${ml === amount ? 'chip-active' : ''}`}
            onClick={() => setMl(amount)}
            type="button"
          >
            {amount} ml
          </button>
        ))}
      </div>
      <Field label="Custom amount (ml)">
        <input className="input" type="number" value={ml} onChange={(e) => setMl(Number(e.target.value))} min={1} max={5000} />
      </Field>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Add water</Button>
      </div>
    </Modal>
  );
}

export function TreadmillModal({ open, onClose, onSaved, date, presets = [], initial, title = 'Log treadmill session' }) {
  const { toast, user } = useApp();
  const tz = user?.timezone || 'Asia/Kolkata';
  const [form, setForm] = useState({
    date: date || defaultDate(),
    presetId: initial?.preset_id || '',
    title: initial?.title || 'Incline Fat-Loss Walk',
    durationMin: initial?.duration_min ?? '',
    speedKmh: initial?.speed_kmh ?? '',
    inclinePct: initial?.incline_pct ?? '',
    distanceKm: initial?.distance_km ?? '',
    avgHr: initial?.avg_hr ?? '',
    maxHr: initial?.max_hr ?? '',
    difficulty: initial?.difficulty || 'comfortable',
    recoveryStatus: initial?.recovery_status || 'good',
    startTime: initial?.start_time ? timeInZone(initial.start_time, tz) : '',
    notes: initial?.notes || '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        date: date || defaultDate(),
        presetId: initial?.preset_id || (presets[0]?.id ?? ''),
        title: initial?.title || presets[0]?.name || 'Incline Fat-Loss Walk',
        durationMin: initial?.duration_min ?? (presets[0]?.totalMinutes ?? ''),
        speedKmh: initial?.speed_kmh ?? '',
        inclinePct: initial?.incline_pct ?? '',
        distanceKm: initial?.distance_km ?? '',
        avgHr: initial?.avg_hr ?? '',
        maxHr: initial?.max_hr ?? '',
        difficulty: initial?.difficulty || 'comfortable',
        recoveryStatus: initial?.recovery_status || 'good',
        startTime: initial?.start_time ? timeInZone(initial.start_time, tz) : '',
        notes: initial?.notes || '',
      });
    }
  }, [open, initial, presets]);

  const save = async () => {
    setBusy(true);
    try {
      // Local wall-clock time is converted to an ISO instant with the offset.
      let startIso = null;
      let endIso = null;
      if (form.startTime) {
        startIso = isoForZonedDateTime(form.date, form.startTime, tz);
        const dur = Number(form.durationMin) || 0;
        endIso = new Date(new Date(startIso).getTime() + dur * 60_000).toISOString();
      }
      const payload = {
        date: form.date,
        presetId: form.presetId || null,
        title: form.title,
        durationMin: form.durationMin === '' ? null : Number(form.durationMin),
        speedKmh: form.speedKmh === '' ? null : Number(form.speedKmh),
        inclinePct: form.inclinePct === '' ? null : Number(form.inclinePct),
        distanceKm: form.distanceKm === '' ? null : Number(form.distanceKm),
        avgHr: form.avgHr === '' ? null : Number(form.avgHr),
        maxHr: form.maxHr === '' ? null : Number(form.maxHr),
        difficulty: form.difficulty,
        recoveryStatus: form.recoveryStatus,
        startTime: startIso,
        endTime: endIso,
        notes: form.notes || null,
      };
      if (initial?.id) {
        await api.put(`/treadmill/sessions/${initial.id}`, payload);
      } else {
        await api.post('/treadmill/sessions', payload);
      }
      toast(initial?.id ? 'Treadmill session updated' : 'Treadmill session logged', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} sub={`Times are in ${tz}. Incline and belt speed are manual unless a treadmill integration supplies them.`} wide>
      <div className="form-grid">
        <Field label="Date">
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Preset">
          <select
            className="select"
            value={form.presetId}
            onChange={(e) => {
              const preset = presets.find((p) => String(p.id) === e.target.value);
              setForm({
                ...form,
                presetId: e.target.value,
                title: preset?.name || form.title,
                durationMin: preset?.totalMinutes ?? form.durationMin,
              });
            }}
          >
            <option value="">Custom session</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Duration (min)">
          <input className="input" type="number" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} />
        </Field>
        <Field label="Start time" hint="Optional. Used to separate treadmill steps from your daily step goal.">
          <input className="input" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        </Field>
        <Field label="Avg speed (km/h)">
          <input className="input" type="number" step="0.1" value={form.speedKmh} onChange={(e) => setForm({ ...form, speedKmh: e.target.value })} />
        </Field>
        <Field label="Incline (%)">
          <input className="input" type="number" step="0.5" value={form.inclinePct} onChange={(e) => setForm({ ...form, inclinePct: e.target.value })} />
        </Field>
        <Field label="Distance (km)">
          <input className="input" type="number" step="0.01" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })} />
        </Field>
        <Field label="Avg HR (bpm)">
          <input className="input" type="number" value={form.avgHr} onChange={(e) => setForm({ ...form, avgHr: e.target.value })} />
        </Field>
        <Field label="Max HR (bpm)">
          <input className="input" type="number" value={form.maxHr} onChange={(e) => setForm({ ...form, maxHr: e.target.value })} />
        </Field>
        <Field label="Difficulty">
          <select className="select" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
            <option value="easy">Easy</option>
            <option value="comfortable">Comfortable</option>
            <option value="moderate">Moderate</option>
            <option value="hard">Hard</option>
          </select>
        </Field>
        <Field label="Recovery after">
          <select className="select" value={form.recoveryStatus} onChange={(e) => setForm({ ...form, recoveryStatus: e.target.value })}>
            <option value="good">Good</option>
            <option value="ok">Okay</option>
            <option value="sore">Sore / tight</option>
            <option value="fatigued">Fatigued</option>
          </select>
        </Field>
        <Field label="Notes" style={{ gridColumn: '1 / -1' }}>
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="How did it feel?" />
        </Field>
      </div>
      <Note tone="info" icon={<span aria-hidden="true">i</span>}>
        If you have an Apple Watch indoor-walk record, leave start time close to the actual session and it will link automatically.
      </Note>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Save session</Button>
      </div>
    </Modal>
  );
}
