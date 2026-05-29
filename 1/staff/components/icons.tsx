// SVG icon set for GAAex. RULE: the product UI uses NO emoji — every icon is an inline SVG here.
// (Emoji are only allowed in human communication: chat, mail, etc. — never in the app.)
// All icons inherit the current text color (stroke="currentColor", fill="none"), so they theme
// automatically. Size via the `size` prop (default 18).
//
// Icon designs by the owner. Grid: 24×24 | stroke: currentColor | strokeWidth: 2 | caps/joins: round
// PlayIcon is filled. RowsIcon has a filled rect. SpinnerIcon is CSS-animated via inline keyframe.

import React from 'react'

export type IconProps = { size?: number; strokeWidth?: number } & React.SVGProps<SVGSVGElement>

function base(
  size: number,
  strokeWidth: number,
  rest: React.SVGProps<SVGSVGElement>,
): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
    ...rest,
  }
}

export const BellIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
)

export const SunIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
  </svg>
)

export const MoonIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
  </svg>
)

export const GearIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
)

export const WarningIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
)

export const CheckIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const CloseIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const ArrowRightIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
)

export const SearchIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const ChevronDownIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const ChevronLeftIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)

export const ChevronRightIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export const MenuIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
)

export const PhoneIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2z" />
  </svg>
)

export const MailIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 6 10 7L22 6" />
  </svg>
)

export const PrinterIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M6 9V2h12v7" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </svg>
)

export const ChartIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M4 4v16h16" />
    <path d="M8 16v-4M13 16V8M18 16v-7" />
  </svg>
)

export const SparkleIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M12 2.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
    <path d="M19 14.5c.3 1.7 1.1 2.5 2.8 2.8-1.7.3-2.5 1.1-2.8 2.8-.3-1.7-1.1-2.5-2.8-2.8 1.7-.3 2.5-1.1 2.8-2.8z" />
  </svg>
)

export const ArrowUpIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
)

export const ArrowDownIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M12 5v14" />
    <path d="m5 12 7 7 7-7" />
  </svg>
)

export const UsersIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
    <path d="M16 3.1a4 4 0 0 1 0 7.8" />
  </svg>
)

export const BuildingIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="5" y="2" width="14" height="20" rx="1" />
    <path d="M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
    <path d="M10 22v-3a2 2 0 0 1 4 0v3" />
  </svg>
)

export const InfoIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
)

export const RowsIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="3" y="5" width="18" height="6" rx="1" fill="currentColor" stroke="none" />
    <path d="M3 16h18" />
    <path d="M3 20h18" />
  </svg>
)

export const MessageIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />
  </svg>
)

export const SmileIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <path d="M9 9h.01M15 9h.01" />
  </svg>
)

export const PlusIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const EditIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
)

export const TrashIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export const ClockIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
)

export const LockIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export const InboxIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z" />
  </svg>
)

export const ReceiptIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M5 2v20l2.5-1.5L10 22l2-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2 1.5L10 2 7.5 3.5z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)

export const CreditCardIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M2 10h20" />
    <path d="M6 15h4" />
  </svg>
)

export const SpinnerIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg
    {...base(size, strokeWidth, {
      style: { animation: 'gx-spin 0.8s linear infinite', ...r.style },
      ...r,
    })}
  >
    <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    <style>{`@keyframes gx-spin{to{transform:rotate(360deg)}}`}</style>
  </svg>
)

export const ServerIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="2" y="3" width="20" height="8" rx="1" />
    <rect x="2" y="13" width="20" height="8" rx="1" />
    <path d="M6 7h.01M6 17h.01" />
  </svg>
)

export const CalendarIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
)

export const DownloadIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
)

export const PauseIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
)

export const PlayIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, { fill: 'currentColor', ...r })}>
    <path d="M6 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5z" />
  </svg>
)

export const SnoozeIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="12" cy="13" r="8" />
    <path d="M5 3 2 6M22 6l-3-3" />
    <path d="M10 11h4l-4 4h4" />
  </svg>
)

export const ArchiveIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
)

export const MuteIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M18 8a6 6 0 0 0-9.3-5" />
    <path d="M6 9c0 7-3 9-3 9h13" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    <path d="m2 2 20 20" />
  </svg>
)

export const BookmarkIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

export const PinIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M9 3h6l-1 6 4 3v2h-5v7l-1 0v-7H6v-2l4-3z" />
  </svg>
)

export const HomeIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M3 10l9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 21v-7h6v7" />
  </svg>
)

export const TruckIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M1 4h13v11H1z" />
    <path d="M14 8h4l3 3v4h-7z" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
  </svg>
)

export const FileIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)

export const MapIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M1 6v16l8-4 8 4 7-4V2l-7 4-8-4-8 4z" />
    <path d="M9 2v16M17 6v16" />
  </svg>
)

export const ShieldIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

export const LayersIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M12 2 2 7l10 5 10-5z" />
    <path d="m2 17 10 5 10-5" />
    <path d="m2 12 10 5 10-5" />
  </svg>
)

export const PackageIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </svg>
)

export const DollarIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M12 1v22" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)

export const BriefcaseIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
)

export const FolderIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

export const GlobeIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
  </svg>
)

export const ActivityIcon = ({ size = 18, strokeWidth = 2, ...r }: IconProps) => (
  <svg {...base(size, strokeWidth, r)}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
)
