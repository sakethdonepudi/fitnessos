import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useApp } from '../state.jsx';
import { initials } from '../lib/format.js';
import {
  IconActivity,
  IconChart,
  IconGrid,
  IconLogout,
  IconShield,
  IconTreadmill,
  IconCamera,
  IconMeal,
  IconSettings,
  IconMenu,
  IconX,
} from './icons.jsx';

const NAV = [
  { to: '/', label: 'Today', icon: IconGrid, end: true },
  { to: '/transformation', label: 'Transformation', icon: IconChart },
  { to: '/treadmill', label: 'Treadmill', icon: IconTreadmill },
  { to: '/training', label: 'Training', icon: IconActivity },
  { to: '/nutrition', label: 'Nutrition', icon: IconMeal },
  { to: '/progress', label: 'Photos', icon: IconCamera },
  { to: '/evidence', label: 'Evidence', icon: IconShield },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

export function TopBar() {
  const { user, logout } = useApp();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <NavLink to="/" className="brand" aria-label="Fitness OS home">
          <span className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19 10 5l6 14" />
              <path d="M16 19 20 5" />
            </svg>
          </span>
          <span>
            FITNESS<span style={{ color: 'var(--lime)' }}>OS</span>
          </span>
        </NavLink>

        <nav className="topnav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button
          className="icon-btn menu-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <IconX size={19} /> : <IconMenu size={19} />}
        </button>

        <div className="topbar-actions">
          <span className="tiny dim" style={{ display: 'none' }}>
            {location.pathname}
          </span>
          <div className="avatar" title={user?.name || ''}>
            {initials(user?.name || 'F')}
          </div>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
            <IconLogout size={17} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="mobile-menu" role="menu">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </header>
  );
}

export function BottomNav() {
  const items = [NAV[0], NAV[2], NAV[1], NAV[4], NAV[6]];
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={19} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function DemoBanner() {
  const { user } = useApp();
  if (!user?.isDemo) return null;
  return (
    <div className="demo-banner">
      <span aria-hidden="true">◆</span>
      Demo mode — every number on this screen is clearly labelled synthetic sample data, not your real progress.
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id} data-kind={t.kind}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              marginTop: 6,
              flexShrink: 0,
              background:
                t.kind === 'error' ? 'var(--red)' : t.kind === 'success' ? 'var(--lime)' : 'var(--teal)',
            }}
          />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
