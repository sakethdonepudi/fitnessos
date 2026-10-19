import React, { useEffect, useState } from 'react';
import { db, nowIso } from '../data/db.js';
import { remote, getSessionToken } from '../data/remote.js';

const urlCache = new Map();

export function invalidatePhoto(id) {
  const url = urlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(id);
}

export function usePhotoUrl(photoId) {
  const [url, setUrl] = useState(() => (photoId ? urlCache.get(photoId) || null : null));
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    if (!photoId) return undefined;
    const cachedUrl = urlCache.get(photoId);
    if (cachedUrl) {
      setUrl(cachedUrl);
      return undefined;
    }
    (async () => {
      let cached = await db.photos.get(photoId);
      let blob = cached?.blob;
      if (!blob && navigator.onLine && getSessionToken() && remote.configured()) {
        try {
          blob = await remote.fetchPhoto(photoId);
          const mime = blob.type || cached?.mime || 'image/jpeg';
          await db.photos.put({
            ...(cached || {}),
            id: photoId,
            blob,
            mime,
            cachedAt: nowIso(),
            remote: true,
            dirty: false,
          });
        } catch {
          blob = null;
        }
      }
      if (cancelled) return;
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        urlCache.set(photoId, objectUrl);
        setUrl(objectUrl);
      } else {
        setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  return { url, missing };
}

export function PhotoImage({ photoId, alt = '', className, onClick, style }) {
  const { url, missing } = usePhotoUrl(photoId);
  if (!url) {
    return (
      <div className={`photo-placeholder ${className || ''}`} style={style} aria-label={missing ? 'Photo unavailable' : 'Loading photo'}>
        <span className="tiny dim">{missing ? 'Photo unavailable' : 'Loading photo…'}</span>
      </div>
    );
  }
  return <img src={url} alt={alt} className={className} onClick={onClick} style={style} loading="lazy" />;
}
