import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, createLocalProfile, processHealthUpdates } from './data/api.js';
import { getRecord } from './data/db.js';
import { initSync, requestSync, syncNow, subscribeSync, syncState } from './data/sync.js';
import { remote, setApiBase, setSessionToken, getSessionToken, clearSession, getApiBase } from './data/remote.js';
import { startCheckpointScheduler, catchUpCheckpoints, stopCheckpointScheduler } from './data/checkpoints.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [goal, setGoal] = useState(null);
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapError, setBootstrapError] = useState(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [sync, setSync] = useState({ ...syncState });
  const [dataVersion, setDataVersion] = useState(0);

  const toast = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const loadBootstrap = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingBootstrap(true);
    try {
      const data = await api.get('/bootstrap');
      setBootstrap(data);
      setProfile(data.profile);
      setGoal(data.goal);
      setUser(data.user);
      setBootstrapError(null);
      setDataVersion((v) => v + 1);
      return data;
    } catch (err) {
      setBootstrapError(err.message);
      return null;
    } finally {
      if (!silent) setLoadingBootstrap(false);
    }
  }, []);

  const activateLocal = useCallback(async () => {
    const p = await getRecord('profile', 'profile');
    if (!p) {
      setUser(null);
      setBootstrapped(true);
      return false;
    }
    await loadBootstrap();
    startCheckpointScheduler();
    catchUpCheckpoints().catch(() => {});
    setBootstrapped(true);
    return true;
  }, [loadBootstrap]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await initSync();
      if (!alive) return;
      await activateLocal();
    })();
    const unsub = subscribeSync((state) => {
      setSync(state);
      if (state.status === 'synced') {
        // A pull may have brought records from another device; refresh silently.
        loadBootstrap({ silent: true });
        processHealthUpdates()
          .then((result) => {
            if (result.processed) loadBootstrap({ silent: true });
          })
          .catch(() => {});
      }
    });
    return () => {
      alive = false;
      unsub();
      stopCheckpointScheduler();
    };
  }, [activateLocal, loadBootstrap]);

  const refresh = useCallback(async () => {
    await loadBootstrap({ silent: true });
    requestSync(200);
  }, [loadBootstrap]);

  const refreshMe = refresh;

  const createProfile = useCallback(
    async (payload, cloud = null) => {
      if (cloud?.apiUrl) setApiBase(cloud.apiUrl);
      const local = await createLocalProfile(payload);
      if (cloud?.passphrase) {
        try {
          if (cloud.setupToken) {
            try {
              const res = await remote.setup(cloud.passphrase, cloud.setupToken);
              setSessionToken(res.token);
            } catch (err) {
              if (err.status !== 409) throw err;
              const res = await remote.login(cloud.passphrase);
              setSessionToken(res.token);
            }
          } else {
            const res = await remote.login(cloud.passphrase);
            setSessionToken(res.token);
          }
          await syncNow();
        } catch (err) {
          toast(`Cloud sync is not connected: ${err.message}`, 'error');
        }
      }
      await activateLocal();
      await initSync();
      return local;
    },
    [activateLocal, toast]
  );

  const loginCloud = useCallback(
    async ({ apiUrl, passphrase }) => {
      setApiBase(apiUrl);
      const res = await remote.login(passphrase);
      setSessionToken(res.token);
      await syncNow();
      const p = await getRecord('profile', 'profile');
      if (!p) {
        // Account exists but has no profile yet; let the caller ask for profile details.
        await activateLocal();
        return { needsProfile: true };
      }
      await activateLocal();
      await initSync();
      return { ok: true };
    },
    [activateLocal]
  );

  const useOffline = useCallback(async () => {
    await activateLocal();
  }, [activateLocal]);

  const connectCloud = useCallback(
    async ({ apiUrl, passphrase, setupToken }) => {
      setApiBase(apiUrl);
      let res;
      if (setupToken) {
        try {
          res = await remote.setup(passphrase, setupToken);
          setSessionToken(res.token);
        } catch (err) {
          if (err.status !== 409) throw err;
          res = await remote.login(passphrase);
          setSessionToken(res.token);
        }
      } else {
        res = await remote.login(passphrase);
        setSessionToken(res.token);
      }
      toast('Cloud connected. Syncing local records…', 'success');
      await syncNow();
      await loadBootstrap({ silent: true });
      await initSync();
      return { ok: true };
    },
    [loadBootstrap, toast]
  );

  const disconnectCloud = useCallback(async () => {
    try {
      await remote.logout();
    } catch {
      // Offline logout is still a local session clear.
    }
    clearSession();
    setSync((s) => ({ ...s, authenticated: false, status: 'local' }));
    toast('Cloud sync disconnected. Local data stays on this device.', 'success');
  }, [toast]);

  const value = useMemo(
    () => ({
      user,
      profile,
      goal,
      bootstrap,
      bootstrapError,
      loadingBootstrap,
      bootstrapped,
      sync,
      dataVersion,
      createProfile,
      loginCloud,
      connectCloud,
      useOffline,
      disconnectCloud,
      refresh,
      refreshMe,
      toast,
      toasts,
      setToasts,
      apiBase: getApiBase(),
    }),
    [
      user,
      profile,
      goal,
      bootstrap,
      bootstrapError,
      loadingBootstrap,
      bootstrapped,
      sync,
      dataVersion,
      createProfile,
      loginCloud,
      connectCloud,
      useOffline,
      disconnectCloud,
      refresh,
      refreshMe,
      toast,
      toasts,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
