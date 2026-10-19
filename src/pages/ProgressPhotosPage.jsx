import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Panel, Button, Modal, Field, Empty, Note, Segmented, StatusBadge } from '../components/ui.jsx';
import {
  IconCamera,
  IconInfo,
  IconPlus,
  IconTrash,
  IconArrowRight,
  IconLock,
  IconShield,
} from '../components/icons.jsx';
import { fmtDate } from '../lib/format.js';
import { PhotoImage } from '../components/PhotoImage.jsx';

const ANGLES = [
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
];

function mondayOf(date = new Date()) {
  const d = new Date(date);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ProgressPhotosPage() {
  const { toast, bootstrap, dataVersion } = useApp();
  const [photos, setPhotos] = useState([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadAngle, setUploadAngle] = useState('front');
  const [weekStart, setWeekStart] = useState(mondayOf());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [compareAngle, setCompareAngle] = useState('front');
  const [mode, setMode] = useState('side');
  const [slider, setSlider] = useState(50);
  const [weekA, setWeekA] = useState(null);
  const [weekB, setWeekB] = useState(null);

  const load = async () => {
    try {
      const res = await api.get('/progress-photos');
      setPhotos(res.photos || []);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
  }, [dataVersion]);

  const byWeek = useMemo(() => {
    const map = new Map();
    for (const p of photos) {
      if (!map.has(p.week_start)) map.set(p.week_start, {});
      map.get(p.week_start)[p.angle] = p;
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [photos]);

  const weeksWithAngle = byWeek.filter(([, angles]) => angles[compareAngle]);
  const effectiveA = weekA && weeksWithAngle.some(([w]) => w === weekA) ? weekA : weeksWithAngle[1]?.[0];
  const effectiveB = weekB && weeksWithAngle.some(([w]) => w === weekB) ? weekB : weeksWithAngle[0]?.[0];
  const photoA = effectiveA ? byWeek.find(([w]) => w === effectiveA)?.[1]?.[compareAngle] : null;
  const photoB = effectiveB ? byWeek.find(([w]) => w === effectiveB)?.[1]?.[compareAngle] : null;

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      fd.append('angle', uploadAngle);
      fd.append('weekStart', weekStart);
      await api.upload('/progress-photos', fd);
      toast('Progress photo saved privately', 'success');
      setFile(null);
      setUploadOpen(false);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/progress-photos/${id}`);
      toast('Photo removed', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Weekly front · side · back · private storage</div>
          <h1 className="page-title">Progress photos</h1>
          <p className="lede">
            Repeatable conditions make photos comparable. These are stored on your machine behind your login. No AI
            analyses them, and none of them are used to invent a body-fat percentage.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setUploadOpen(true)}><IconPlus size={14} /> Add photo</Button>
      </div>

      <div className="photo-layout">
        <div className="stack">
          <Panel title="Compare" sub="Same angle, same conditions, different weeks" action={<Segmented value={mode} onChange={setMode} options={[{ value: 'side', label: 'Side by side' }, { value: 'slider', label: 'Overlay' }]} />}>
            <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <Segmented value={compareAngle} onChange={setCompareAngle} options={ANGLES.map((a) => ({ value: a.id, label: a.label }))} label="Angle" />
              <span className="spacer" />
              <select className="select" style={{ width: 150, height: 32 }} value={effectiveA || ''} onChange={(e) => setWeekA(e.target.value)}>
                {weeksWithAngle.map(([w]) => <option key={w} value={w}>{fmtDate(w)}</option>)}
              </select>
              <span className="tiny dim">vs</span>
              <select className="select" style={{ width: 150, height: 32 }} value={effectiveB || ''} onChange={(e) => setWeekB(e.target.value)}>
                {weeksWithAngle.map(([w]) => <option key={w} value={w}>{fmtDate(w)}</option>)}
              </select>
            </div>

            {photoA && photoB ? (
              mode === 'side' ? (
                <div className="photo-compare photo-compare-lg">
                  <figure className="photo-frame">
                    <PhotoImage photoId={photoA.photo_id} alt={`${compareAngle} ${effectiveA}`} />
                    <figcaption className="photo-label">{fmtDate(effectiveA)}</figcaption>
                  </figure>
                  <figure className="photo-frame">
                    <PhotoImage photoId={photoB.photo_id} alt={`${compareAngle} ${effectiveB}`} />
                    <figcaption className="photo-label">{fmtDate(effectiveB)}</figcaption>
                  </figure>
                </div>
              ) : (
                <div className="photo-overlay">
                  <PhotoImage photoId={photoB.photo_id} alt={`${compareAngle} ${effectiveB}`} />
                  <div className="photo-overlay-top" style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}>
                    <PhotoImage photoId={photoA.photo_id} alt={`${compareAngle} ${effectiveA}`} />
                  </div>
                  <div className="photo-overlay-handle" style={{ left: `${slider}%` }} />
                  <input
                    className="photo-overlay-range"
                    type="range"
                    min="0"
                    max="100"
                    value={slider}
                    onChange={(e) => setSlider(Number(e.target.value))}
                    aria-label="Comparison slider"
                  />
                  <span className="photo-overlay-tag" style={{ left: 10 }}>{fmtDate(effectiveA)}</span>
                  <span className="photo-overlay-tag" style={{ right: 10 }}>{fmtDate(effectiveB)}</span>
                </div>
              )
            ) : (
              <Empty icon={<IconCamera size={20} />} title={`No ${compareAngle} photos to compare`}>
                Add this angle in at least two different weeks. Consistency of position matters more than
                photogenic lighting.
              </Empty>
            )}

            <Note tone="info" icon={<IconInfo size={14} />}>
              Compare posture, waist line and overall shape over weeks — not day to day. Lighting, hydration and
              posture change the image far more than a day of fat loss.
            </Note>
          </Panel>

          <Panel title="Library" sub={`${photos.length} photos across ${byWeek.length} weeks`} flush>
            {byWeek.length === 0 ? (
              <Empty icon={<IconCamera size={20} />} title="No progress photos yet">
                Weekly photos are optional. A missing photo is not a missing week of effort.
              </Empty>
            ) : (
              <div className="photo-weeks">
                {byWeek.map(([week, angles]) => (
                  <div className="photo-week" key={week}>
                    <div className="photo-week-head">
                      <span className="small" style={{ fontWeight: 600 }}>Week of {fmtDate(week)}</span>
                      <span className="tiny dim">{Object.keys(angles).length}/3 angles</span>
                    </div>
                    <div className="photo-week-grid">
                      {ANGLES.map((angle) => {
                        const photo = angles[angle.id];
                        return (
                          <div className={`photo-thumb ${photo ? '' : 'photo-thumb-empty'}`} key={angle.id}>
                            {photo ? (
                              <>
                                <PhotoImage photoId={photo.photo_id} alt={`${angle.label} ${fmtDate(week)}`} />
                                <span className="photo-thumb-label">{angle.label}</span>
                                <button className="photo-thumb-remove" onClick={() => remove(photo.id)} aria-label={`Remove ${angle.label} photo`}>
                                  <IconTrash size={12} />
                                </button>
                              </>
                            ) : (
                              <>
                                <IconCamera size={16} />
                                <span className="tiny dim">{angle.label}</span>
                                <button
                                  className="btn btn-sm"
                                  style={{ marginTop: 6, height: 24 }}
                                  onClick={() => {
                                    setUploadAngle(angle.id);
                                    setWeekStart(week);
                                    setUploadOpen(true);
                                  }}
                                >
                                  Add
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Repeatable setup" sub="Camera position guidance">
            <div className="camera-guide">
              <svg viewBox="0 0 160 220" className="camera-guide-svg" aria-hidden="true">
                <rect x="4" y="4" width="152" height="212" rx="10" fill="none" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 6" />
                <path d="M80 34c10 0 17 8 17 18s-7 18-17 18-17-8-17-18 7-18 17-18Z" fill="none" stroke="var(--lime)" strokeWidth="1.5" opacity="0.7" />
                <path d="M80 72v64M80 88 54 118M80 88l26 30M80 136l-22 46M80 136l22 46" fill="none" stroke="var(--lime)" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
                <line x1="20" y1="70" x2="20" y2="150" stroke="var(--teal)" strokeWidth="1" />
                <line x1="140" y1="70" x2="140" y2="150" stroke="var(--teal)" strokeWidth="1" />
                <line x1="20" y1="110" x2="8" y2="110" stroke="var(--teal)" strokeWidth="1" />
                <line x1="140" y1="110" x2="152" y2="110" stroke="var(--teal)" strokeWidth="1" />
                <text x="80" y="202" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8">full body in frame</text>
                <text x="80" y="212" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="7">camera at navel height</text>
              </svg>
              <div className="camera-guide-copy">
                <div className="camera-step"><span>1</span>Same spot, same distance, same time of day.</div>
                <div className="camera-step"><span>2</span>Camera at navel height, lens vertical, full body in frame.</div>
                <div className="camera-step"><span>3</span>Neutral posture, arms relaxed, feet shoulder-width.</div>
                <div className="camera-step"><span>4</span>Consistent light — avoid dramatic side lighting.</div>
              </div>
            </div>
            <div className="photo-storage-note">
              <IconLock size={14} />
              <span>Photos are stored privately on disk and served only to your authenticated account.</span>
            </div>
          </Panel>

          <Panel title="What photos are for" sub="And what they are not for">
            <div className="stack" style={{ gap: 10 }}>
              <p className="small muted">
                Photos show shape and posture over time. They are a qualitative check that can catch a trend the scale
                hides.
              </p>
              <Note tone="warn" icon={<IconShield size={14} />}>
                This app will not use AI to claim a precise body-fat percentage from a photo. Any body-fat number shown
                elsewhere is either measured by a device or explicitly labelled as an estimate.
              </Note>
              <p className="tiny dim">
                Private storage means no third-party image service, no cloud analysis and no model training on your
                photos.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Add progress photo" sub="Stored privately. Choose the week and angle so comparisons line up.">
        <div className="stack" style={{ gap: 14 }}>
          <div className="form-grid">
            <Field label="Week of">
              <input className="input" type="date" value={weekStart} onChange={(e) => setWeekStart(mondayOf(new Date(`${e.target.value}T12:00:00`)))} />
            </Field>
            <Field label="Angle">
              <select className="select" value={uploadAngle} onChange={(e) => setUploadAngle(e.target.value)}>
                {ANGLES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Field>
          </div>

          <input id="progress-file" type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <label htmlFor="progress-file" className="console-drop" style={{ minHeight: 150 }}>
            <IconCamera size={26} />
            <span>{file ? file.name : 'Choose a photo'}</span>
            <span className="tiny dim">Front, side and back can be added separately</span>
          </label>

          <Note tone="info" icon={<IconInfo size={14} />}>
            Replacing an angle for the same week keeps only the newest photo. Original files are deleted from disk.
          </Note>

          <div className="form-actions">
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={upload} disabled={!file || busy}>
              {busy ? <span className="spinner" /> : 'Save photo'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
