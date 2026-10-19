import React, { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Button } from './ui.jsx';
import { IconRefreshCw } from './icons.jsx';

export default function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateSW, setUpdateSW] = useState(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
    });
    setUpdateSW(() => update);
    return undefined;
  }, []);

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="update-prompt" role="status">
      <div className="update-prompt-copy">
        <strong>{needRefresh ? 'Update available' : 'Ready offline'}</strong>
        <span>
          {needRefresh
            ? 'A new version of Fitness OS has been downloaded.'
            : 'The app shell is cached. It will open without a connection.'}
        </span>
      </div>
      {needRefresh ? (
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
            Later
          </Button>
          <Button size="sm" variant="primary" onClick={() => updateSW?.(true)}>
            <IconRefreshCw size={13} /> Reload
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOfflineReady(false)}>
          Got it
        </Button>
      )}
    </div>
  );
}
