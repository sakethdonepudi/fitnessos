import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './state.jsx';
import { TopBar, BottomNav, DemoBanner, Toasts } from './components/shell.jsx';
import AuthPage from './pages/AuthPage.jsx';
import TodayPage from './pages/TodayPage.jsx';
import TransformationPage from './pages/TransformationPage.jsx';
import TreadmillPage from './pages/TreadmillPage.jsx';
import TrainingPage from './pages/TrainingPage.jsx';
import NutritionPage from './pages/NutritionPage.jsx';
import ProgressPhotosPage from './pages/ProgressPhotosPage.jsx';
import EvidencePage from './pages/EvidencePage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  const { user, bootstrapped } = useApp();

  if (!bootstrapped) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthPage />
        <Toasts />
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopBar />
      <DemoBanner />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/transformation" element={<TransformationPage />} />
          <Route path="/treadmill" element={<TreadmillPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/nutrition" element={<NutritionPage />} />
          <Route path="/progress" element={<ProgressPhotosPage />} />
          <Route path="/evidence" element={<EvidencePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <Toasts />
    </div>
  );
}
