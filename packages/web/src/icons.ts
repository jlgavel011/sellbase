/** Inline SVG icons for the web components (no emoji, no icon font). They use currentColor. */
const svg = (d: string) =>
  `<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

export const icons = {
  cart: svg('M2.5 3.5h2l1.8 9h9.2l1.5-6.5H5.4M8 16.5h.01M14 16.5h.01'),
  close: svg('M5 5l10 10M15 5 5 15'),
  calendar: svg(
    'M4.5 4.5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM3.5 8.5h13M7 2.5v3M13 2.5v3',
  ),
  truck: svg(
    'M2.5 5h9.5v8.5H2.5ZM12 8h3l2.5 2.8v2.7H12M5.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM14.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  ),
  download: svg('M10 3.5V13M6 9l4 4 4-4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13'),
};
