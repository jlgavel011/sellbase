/**
 * Sellbase storefront icons: inline SVG, 20×20, stroked with currentColor, so they take
 * your text color and size (1.15em). Decorative by default (aria-hidden); pass a `title`
 * when the icon is the only content of a control. Edit or replace them freely.
 */
import type { SVGProps } from 'react';

const PATHS = {
  cart: 'M2.5 3.5h2l1.8 9h9.2l1.5-6.5H5.4M8 16.5h.01M14 16.5h.01',
  close: 'M5 5l10 10M15 5 5 15',
  calendar:
    'M4.5 4.5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM3.5 8.5h13M7 2.5v3M13 2.5v3',
  truck:
    'M2.5 5h9.5v8.5H2.5ZM12 8h3l2.5 2.8v2.7H12M5.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM14.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  download: 'M10 3.5V13M6 9l4 4 4-4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13',
  image:
    'M4 3.5h12a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM3.5 13.5l3.8-3.8a1 1 0 0 1 1.4 0l5.8 5.8M11.5 11.5l1.3-1.3a1 1 0 0 1 1.4 0l2.3 2.3M12.5 7.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  title,
  ...props
}: { name: IconName; title?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="1.15em"
      height="1.15em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{ display: 'inline-block', verticalAlign: '-0.2em', flexShrink: 0 }}
      {...props}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
