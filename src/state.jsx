import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [goal, setGoal] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapError, setBootstrapError] = useState(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    try {
      const data = await api.get('/bootstrap');
      setBootstrap(data);
      setBootstrapError(null);
      return data;
    } catch (err) {
      if (err.status === 401) {
        setUser(null);
      } else {
        setBootstrapError(err.message);
      }
      return null;
    } finally {
      setLoadingBootstrap(false);
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setUser(me.user);
      setProfile(me.profile);
      setGoal(me.goal);
      await loadBootstrap();
    } catch (err) {
      setUser(null);
      setProfile(null);
      setGoal(null);
    } finally {
      setBootstrapped(true);
    }
  }, [loadBootstrap]);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = useCallback(
    async (email, password) => {
      const res = await api.post('/auth/login', { email, password });
      setUser(res.user);
      await loadBootstrap();
      return res;
    },
    [loadBootstrap]
  );

  const register = useCallback(
    async (payload) => {
      const res = await api.post('/auth/register', payload);
      setUser(res.user);
      await loadBootstrap();
      return res;
    },
    [loadBootstrap]
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout', {});
    setUser(null);
    setProfile(null);
    setGoal(null);
    setBootstrap(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      goal,
      bootstrap,
      bootstrapError,
      loadingBootstrap,
      bootstrapped,
      login,
      register,
      logout,
      refresh: loadBootstrap,
      refreshMe,
      toast,
      toasts,
      setToasts,
    }),
    [user, profile, goal, bootstrap, bootstrapError, loadingBootstrap, bootstrapped, login, register, logout, loadBootstrap, refreshMe, toast, toasts]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
