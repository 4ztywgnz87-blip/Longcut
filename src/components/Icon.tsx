// Small stroke icons, drawn inline so the app needs no icon font.
const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  'star-filled': 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  swap: 'M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3',
  loop: 'M4.6 9A8 7.2 0 0 1 19.9 11.4M19.9 11.4l-2.8-1.6M19.9 11.4l1.7-2.7M19.4 15A8 7.2 0 0 1 4.1 12.6M4.1 12.6l2.8 1.6M4.1 12.6l-1.7 2.7',
  minus: 'M5 12h14',
  chevron: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  again: 'M3 7h4c4 0 6 10 10 10h4M18 14l3 3-3 3M3 17h4c1.6 0 2.8-1.6 3.9-3.5M13.1 9.5C14.2 8.4 15.4 7 17 7h4M18 4l3 3-3 3',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  'my-location': 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  const filled = name === 'star-filled';
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
      {name === 'my-location' && <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />}
    </svg>
  );
}
