import React from 'react';

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function make(paths) {
  return function Icon({ size = 18, ...props }) {
    return (
      <svg {...base} width={size} height={size} aria-hidden="true" {...props}>
        {paths}
      </svg>
    );
  };
}

export const IconActivity = make(<path d="M3 12h4l3 8 4-16 3 8h4" />);
export const IconTreadmill = make(
  <>
    <path d="M3 17h18" />
    <path d="M5 17 8 7h6l3 10" />
    <path d="M8 7h10" />
    <circle cx="17" cy="5" r="1.4" />
  </>
);
export const IconHeart = make(
  <path d="M20.8 5.6a5.1 5.1 0 0 0-7.2 0L12 7.2l-1.6-1.6a5.1 5.1 0 1 0-7.2 7.2l8.8 8.8 8.8-8.8a5.1 5.1 0 0 0 0-7.2Z" />
);
export const IconSteps = make(
  <>
    <path d="M8 3c1.7 0 2.5 1.5 2.5 3.5S9.7 10 8 10s-2.5-1.5-2.5-3.5S6.3 3 8 3Z" />
    <path d="M16 8c1.7 0 2.5 1.5 2.5 3.5S17.7 15 16 15s-2.5-1.5-2.5-3.5S14.3 8 16 8Z" />
    <path d="M5 14c1.5 0 2.5 1 2.5 2.5S6.5 19 5 19" />
  </>
);
export const IconScale = make(
  <>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M8 10a4 4 0 0 1 8 0" />
    <path d="M12 10v3" />
  </>
);
export const IconCamera = make(
  <>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.4" />
  </>
);
export const IconDroplet = make(
  <path d="M12 2.7 6.9 8a7.2 7.2 0 1 0 10.2 0L12 2.7Z" />
);
export const IconFlame = make(
  <path d="M12 22c4.4 0 7-2.9 7-6.7 0-4.6-4.3-6.6-4.3-11.3-2.2.8-3.4 2.6-3.4 4.9-1.2-.6-2-1.7-2.3-3.2C6.8 7.6 5 10.3 5 15.3 5 19.1 7.6 22 12 22Z" />
);
export const IconChart = make(
  <>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 16v-4" />
    <path d="M12 16V8" />
    <path d="M16 16v-6" />
    <path d="M20 16v-9" />
  </>
);
export const IconTarget = make(
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.4" />
  </>
);
export const IconShield = make(
  <>
    <path d="M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </>
);
export const IconCheck = make(<path d="m4.5 12.5 5 5 10-11" />);
export const IconPlus = make(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>
);
export const IconX = make(
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </>
);
export const IconChevronRight = make(<path d="m9 5 7 7-7 7" />);
export const IconChevronLeft = make(<path d="m15 5-7 7 7 7" />);
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </>
);
export const IconCalendar = make(
  <>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
  </>
);
export const IconMoon = make(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </>
);
export const IconDumbbell = make(
  <>
    <path d="M3 9v6M6 7v10M18 7v10M21 9v6" />
    <path d="M6 12h12" />
  </>
);
export const IconTrendingDown = make(
  <>
    <path d="m3 7 6 6 4-4 8 8" />
    <path d="M21 12v5h-5" />
  </>
);
export const IconTrendingUp = make(
  <>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M21 7v5h-5" />
  </>
);
export const IconRefresh = make(
  <>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </>
);
export const IconWatch = make(
  <>
    <rect x="6" y="6" width="12" height="12" rx="4" />
    <path d="M9 6V3h6v3M9 18v3h6v-3" />
  </>
);
export const IconLock = make(
  <>
    <rect x="4" y="10" width="16" height="11" rx="3" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </>
);
export const IconAlert = make(
  <>
    <path d="M12 3 2.5 20h19L12 3Z" />
    <path d="M12 9v5" />
    <path d="M12 17.5v.5" />
  </>
);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8v.5" />
  </>
);
export const IconLogout = make(
  <>
    <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
    <path d="m16 16 4-4-4-4" />
    <path d="M20 12H9" />
  </>
);
export const IconMenu = make(
  <>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </>
);
export const IconGrid = make(
  <>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </>
);
export const IconMeal = make(
  <>
    <path d="M6 3v8a2 2 0 0 0 4 0V3" />
    <path d="M8 11v10" />
    <path d="M17 3c-1.7 1.4-2.5 3.3-2.5 5.5 0 1.7.9 2.9 2.5 3.4V21" />
  </>
);
export const IconPlay = make(<path d="m8 5 11 7-11 7V5Z" />);
export const IconPause = make(
  <>
    <rect x="7" y="5" width="3.5" height="14" rx="1" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
  </>
);
export const IconTrash = make(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
  </>
);
export const IconEdit = make(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
  </>
);
export const IconSpark = make(
  <>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 8.5 13.4 11l2.6 1-2.6 1L12 15.5 10.6 13 8 12l2.6-1L12 8.5Z" />
  </>
);
export const IconArrowRight = make(
  <>
    <path d="M4 12h16" />
    <path d="m14 6 6 6-6 6" />
  </>
);
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
  </>
);
export const IconRefreshCw = make(
  <>
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </>
);
