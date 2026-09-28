import { useId, type SVGProps } from 'react';

/*
 * Sellbase icon set: 20×20, 1.6 stroke, round caps (drawn for the admin, no icon font or
 * package). Pass `className` to size or color it; icons are decorative unless given a title.
 */

const PATHS = {
  home: 'M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-4.5h-4V17H4.5a1 1 0 0 1-1-1Z',
  orders:
    'M4 3.5h12a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM3.5 11h4l1 2h3l1-2h4',
  products:
    'M10.6 3.5H16a.5.5 0 0 1 .5.5v5.4a1 1 0 0 1-.3.7l-6.6 6.6a1 1 0 0 1-1.4 0L3.3 11.8a1 1 0 0 1 0-1.4l6.6-6.6a1 1 0 0 1 .7-.3ZM13 7h.01',
  customers:
    'M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 16.5c.4-2.8 2.4-4.5 5-4.5s4.6 1.7 5 4.5M13 3.7a3 3 0 0 1 0 5.6M14.5 12.3c1.6.5 2.7 2 3 4.2',
  discounts:
    'M8 12l4-4M8.2 8h.01M11.8 12h.01M9.2 2.9a1.2 1.2 0 0 1 1.6 0l1.3 1.1 1.7-.1c.7 0 1.2.5 1.2 1.2l-.1 1.7 1.1 1.3c.5.5.5 1.2 0 1.6l-1.1 1.3.1 1.7c0 .7-.5 1.2-1.2 1.2l-1.7-.1-1.3 1.1c-.5.5-1.2.5-1.6 0L7.9 15.8l-1.7.1c-.7 0-1.2-.5-1.2-1.2l.1-1.7-1.1-1.3a1.2 1.2 0 0 1 0-1.6l1.1-1.3L5 7.1c0-.7.5-1.2 1.2-1.2l1.7.1Z',
  calendar:
    'M4.5 4.5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM3.5 8.5h13M7 2.5v3M13 2.5v3',
  settings:
    'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.6 2.6h2.8l.4 2 1.4.8 1.9-.7 1.4 2.4-1.5 1.3v1.6l1.5 1.3-1.4 2.4-1.9-.7-1.4.8-.4 2H8.6l-.4-2-1.4-.8-1.9.7-1.4-2.4 1.5-1.3V9.2L3.5 7.9l1.4-2.4 1.9.7 1.4-.8Z',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM17 17l-3.8-3.8',
  plus: 'M10 4.5v11M4.5 10h11',
  minus: 'M4.5 10h11',
  chevronLeft: 'M12 4.5 6.5 10l5.5 5.5',
  chevronRight: 'M8 4.5l5.5 5.5L8 15.5',
  chevronDown: 'M4.5 8l5.5 5.5L15.5 8',
  arrowLeft: 'M16 10H4M9 5l-5 5 5 5',
  image:
    'M4 3.5h12a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM3.5 13.5l3.8-3.8a1 1 0 0 1 1.4 0l5.8 5.8M11.5 11.5l1.3-1.3a1 1 0 0 1 1.4 0l2.3 2.3M12.5 7.5h.01',
  upload: 'M10 13V3.5M6 7.5l4-4 4 4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13',
  download: 'M10 3.5V13M6 9l4 4 4-4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13',
  trash:
    'M3.5 5.5h13M8 5.5V4a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M5 5.5l.8 10.1a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L15 5.5M8.5 9v4.5M11.5 9v4.5',
  grip: 'M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01',
  x: 'M5 5l10 10M15 5 5 15',
  check: 'M4 10.5 8 14.5 16 5.5',
  checkCircle: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM6.8 10.2l2.2 2.2 4.2-4.6',
  circle: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z',
  dashedCircle:
    'M10 2.5a7.5 7.5 0 0 1 2.6.5M16.5 6.3a7.5 7.5 0 0 1 .9 3.7M17 12.7a7.5 7.5 0 0 1-2.1 3M11.5 17.3a7.5 7.5 0 0 1-3 0M5 15.7a7.5 7.5 0 0 1-2.1-3M2.6 10a7.5 7.5 0 0 1 .9-3.7M5.3 4.2A7.5 7.5 0 0 1 7.4 3',
  external:
    'M11.5 3.5h5v5M16.5 3.5l-7 7M14 11.5v4a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
  printer:
    'M5.5 7.5V3.5h9v4M5.5 14.5h-1a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1M5.5 11.5h9v5h-9Z',
  mail: 'M3.5 5h13a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5ZM3.2 5.4 10 11l6.8-5.6',
  cart: 'M2.5 3.5h2l1.8 9h9.2l1.5-6.5H5.4M8 16.5h.01M14 16.5h.01',
  inventory: 'M10 2.8 16.5 6v8L10 17.2 3.5 14V6ZM3.5 6 10 9.2 16.5 6M10 9.2v8M6.8 4.4l6.5 3.2',
  collections:
    'M3.5 5.5h5l1.5 1.5h6.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z',
  store:
    'M3.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8M2.5 4.5l1.3-2h12.4l1.3 2v1.2a2.3 2.3 0 0 1-4.6 0 2.3 2.3 0 0 1-4.8 0 2.3 2.3 0 0 1-4.6 0ZM8 16.5v-4.5h4v4.5',
  card: 'M3 5h14a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 3 5ZM2.5 8.5h15M5.5 12.5h3',
  truck:
    'M2.5 5h9.5v8.5H2.5ZM12 8h3l2.5 2.8v2.7H12M5.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM14.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  receipt:
    'M5 2.5h10v15l-2-1.3-1.7 1.3-1.3-1.3-1.3 1.3L7 16.2 5 17.5ZM7.5 6.5h5M7.5 9.5h5M7.5 12.5h3',
  bell: 'M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13ZM8 15.5a2 2 0 0 0 4 0',
  shield: 'M10 2.5 16 5v4.8c0 3.6-2.5 6.5-6 7.7-3.5-1.2-6-4.1-6-7.7V5ZM7.2 10l2 2 3.8-4',
  users: 'M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 17c.5-3 2.9-5 6-5s5.5 2 6 5',
  bot: 'M5 7.5h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1ZM10 4.5v3M10 4.5h.01M7.5 11h.01M12.5 11h.01M8 13.5h4M2.5 11v2M17.5 11v2',
  webhook:
    'M8.5 5.5a2.5 2.5 0 1 1 3.3 2.4l2.2 4.1M5.3 14.5h5.2a2.5 2.5 0 1 1 2.8 2.4M9.4 8.7l-2.6 4.5a2.5 2.5 0 1 1-2.3-1',
  plug: 'M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0ZM10 14.5v3',
  logout: 'M8 3.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H8M12.5 6.5 16 10l-3.5 3.5M16 10H7.5',
  menu: 'M3.5 5.5h13M3.5 10h13M3.5 14.5h13',
  copy: 'M7.5 7.5h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM4.5 12.5h-.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 1 1v.5',
  eye: 'M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10ZM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  alert: 'M10 3 17.5 16h-15ZM10 8v3.5M10 13.8h.01',
  info: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 9v4.5M10 6.5h.01',
  sparkles:
    'M8.5 3.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3L4 8l3.3-1.2ZM14.5 11.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  chart: 'M3.5 16.5h13M5.5 13.5v-3M9 13.5v-7M12.5 13.5v-5M16 13.5V4.5',
  globe:
    'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM2.5 10h15M10 2.5c2 2 3 4.5 3 7.5s-1 5.5-3 7.5c-2-2-3-4.5-3-7.5s1-5.5 3-7.5Z',
  lock: 'M5.5 9h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1ZM7 9V6.5a3 3 0 0 1 6 0V9',
  file: 'M5 2.5h6.5l3.5 3.5v11a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5ZM11.5 2.5V6H15',
  refresh: 'M16 9.5a6 6 0 0 0-11-2.8M4 10.5a6 6 0 0 0 11 2.8M4 3.5v3.5h3.5M16 16.5V13h-3.5',
  pencil: 'M12.5 4.5l3 3L7 16H4v-3ZM11 6l3 3',
  link: 'M8.5 11.5a3 3 0 0 0 4.3 0l2.5-2.5a3 3 0 0 0-4.3-4.3l-.8.8M11.5 8.5a3 3 0 0 0-4.3 0L4.7 11a3 3 0 0 0 4.3 4.3l.8-.8',
  clock: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 6v4l2.5 2',
  tag: 'M3.5 3.5h6l7 7-6 6-7-7ZM7 7h.01',
  percent:
    'M5 15 15 5M6 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM14 15.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  filter: 'M3 4.5h14l-5.5 6.5v5l-3-1.5v-3.5Z',
  note: 'M4.5 3.5h11a1 1 0 0 1 1 1v8L12.5 16.5h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM12.5 16.5v-4h4',
  command:
    'M7 7V5.5A2 2 0 1 0 5 7.5h1.5M13 7V5.5a2 2 0 1 1 2 2h-1.5M7 13v1.5A2 2 0 1 1 5 12.5h1.5M13 13v1.5a2 2 0 1 0 2-2h-1.5M7 7h6v6H7Z',
  arrowRight: 'M4 10h12M11 5l5 5-5 5',
  enter: 'M16 4.5v5a2 2 0 0 1-2 2H4.5M8 8l-3.5 3.5L8 15',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  title,
  className,
  ...props
}: { name: IconName; title?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={className ?? 'sb:h-5 sb:w-5 sb:shrink-0'}
      {...props}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Sellbase mark: an "S" of two stacked layers (the base) with an AI spark. */
export function SellbaseMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className ?? 'sb:h-7 sb:w-7'}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7bff" />
          <stop offset="0.5" stopColor="#5b4bff" />
          <stop offset="1" stopColor="#1fb8e6" />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}g)`} />
      <rect width="32" height="32" rx="9" fill={`url(#${id}h)`} />
      <path
        d="M21 10H13.25a3 3 0 0 0 0 6h5.5a3 3 0 0 1 0 6H10"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24.6 5.2l.75 1.75 1.75.75-1.75.75-.75 1.75-.75-1.75-1.75-.75 1.75-.75Z"
        fill="#fff"
      />
    </svg>
  );
}

/** Mark + "sellbase" wordmark. `tone` is the text color: light on dark frames. */
export function SellbaseLogo({
  tone = 'dark',
  size = 'md',
}: {
  tone?: 'light' | 'dark';
  size?: 'md' | 'lg';
}) {
  return (
    <span className="sb:inline-flex sb:items-center sb:gap-2">
      <SellbaseMark className={size === 'lg' ? 'sb:h-9 sb:w-9' : 'sb:h-7 sb:w-7'} />
      <span
        className={`sb:font-bold sb:tracking-[-0.04em] ${size === 'lg' ? 'sb:text-2xl' : 'sb:text-[1.0625rem]'} ${tone === 'light' ? 'sb:text-white' : 'sb:text-[var(--sba-text-strong)]'}`}
      >
        sellbase
      </span>
    </span>
  );
}
