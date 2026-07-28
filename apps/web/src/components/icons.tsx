interface IconProps {
  className?: string;
}

/** Inline SVG throughout, so the app ships no icon font and no extra request. */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function CarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 17h14M6.5 17V9.8a1 1 0 0 1 .3-.7l1.6-1.6a1 1 0 0 1 .7-.3h5.8a1 1 0 0 1 .7.3l1.6 1.6a1 1 0 0 1 .3.7V17" />
      <path d="M4 12.5h16" />
      <circle cx="8" cy="17" r="1.6" />
      <circle cx="16" cy="17" r="1.6" />
    </svg>
  );
}

export function WalkIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="13" cy="4.6" r="1.9" />
      <path d="M11 21l1.6-5.2-2.4-2.3.9-4.6 3.2 2 2.7 1" />
      <path d="M10.1 9.9L7.4 11 6 14.4" />
      <path d="M12.6 15.8L15.4 21" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

export function BoltIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" />
    </svg>
  );
}

export function RainIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7.5 15.5a4 4 0 0 1 .3-8 5.2 5.2 0 0 1 9.9 1.3 3.4 3.4 0 0 1-.7 6.7" />
      <path d="M9 18.5l-.8 2M13 18.5l-.8 2M17 18.5l-.8 2" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M18.4 5.6l-1.3 1.3M6.9 17.1l-1.3 1.3" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8L20 20" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.7.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.5 10l5.2-.8z" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5Z" />
      <path d="M10.2 18.5a2 2 0 0 0 3.6 0" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 6.5h15M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M6.5 6.5 7.3 19a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1l.8-12.5" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4.8 3.2 19.2h17.6z" />
      <path d="M12 10v3.6M12 16.6v.1" />
    </svg>
  );
}
