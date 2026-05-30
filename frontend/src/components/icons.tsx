// Icon set for GAAex. RULE: the product UI uses NO emoji — every icon is an inline SVG here.
// (Emoji are only allowed in human communication: chat, mail, etc. — never in the app.)
//
// IMPLEMENTATION (Design-system reskin, PROMPT 10): each export is a tiny wrapper around the
// equivalent lucide-react icon. We keep the EXACT same exported component names and a
// backwards-compatible prop signature (size, strokeWidth, className, style, plus all SVG props
// like aria-hidden, onClick, etc.) so every existing call site keeps working untouched.
//
// Lucide icons render as inline <svg> elements with stroke="currentColor" by default, so they
// theme automatically — the same convention the hand-rolled set used. Default size: 18.
// Default strokeWidth: 2 (matches the kit's 2px-stroke spec — design-system/README.md §4).

import React from 'react'
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BellOff,
  Bell,
  Bookmark,
  Briefcase,
  Building,
  Calendar,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  FileText,
  Folder,
  Globe,
  Home,
  Inbox,
  Info,
  Layers,
  Loader2,
  Lock,
  Mail,
  Map,
  Menu,
  MessageCircle,
  Moon,
  Package,
  Pause,
  Pencil,
  Phone,
  Pin,
  Play,
  Plus,
  Printer,
  Receipt,
  Rows,
  Search,
  Server,
  Settings,
  Shield,
  Smile,
  Sparkles,
  AlarmClock,
  Sun,
  Trash2,
  Truck,
  Users,
  X,
} from 'lucide-react'

export type IconProps = { size?: number; strokeWidth?: number } & React.SVGProps<SVGSVGElement>

// `lucide-react` accepts size + strokeWidth as numeric/string props plus passes any other svg
// attributes through to the underlying <svg>. The shapes are compatible with our IconProps —
// we just relax the type when handing off because Lucide's own typing differs slightly from
// React.SVGProps in a few edge cases (e.g. `color`).
type AnyLucide = React.ComponentType<any>
const W = (
  Cmp: AnyLucide,
  size: number | undefined,
  strokeWidth: number | undefined,
  rest: React.SVGProps<SVGSVGElement>,
) =>
  React.createElement(Cmp, {
    size: size ?? 18,
    strokeWidth: strokeWidth ?? 2,
    'aria-hidden': true,
    ...rest,
  })

export const BellIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Bell, size, strokeWidth, r)
export const SunIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Sun, size, strokeWidth, r)
export const MoonIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Moon, size, strokeWidth, r)
export const GearIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Settings, size, strokeWidth, r)
export const WarningIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(AlertTriangle, size, strokeWidth, r)
export const CheckIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Check, size, strokeWidth, r)
export const CloseIcon = ({ size, strokeWidth, ...r }: IconProps) => W(X, size, strokeWidth, r)
export const ArrowRightIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(ArrowRight, size, strokeWidth, r)
export const SearchIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Search, size, strokeWidth, r)
export const ChevronDownIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(ChevronDown, size, strokeWidth, r)
export const ChevronLeftIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(ChevronLeft, size, strokeWidth, r)
export const ChevronRightIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(ChevronRight, size, strokeWidth, r)
export const MenuIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Menu, size, strokeWidth, r)
export const PhoneIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Phone, size, strokeWidth, r)
export const MailIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Mail, size, strokeWidth, r)
export const PrinterIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Printer, size, strokeWidth, r)
export const ChartIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(BarChart3, size, strokeWidth, r)
export const SparkleIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Sparkles, size, strokeWidth, r)
export const ArrowUpIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(ArrowUp, size, strokeWidth, r)
export const ArrowDownIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(ArrowDown, size, strokeWidth, r)
export const UsersIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Users, size, strokeWidth, r)
export const BuildingIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Building, size, strokeWidth, r)
export const InfoIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Info, size, strokeWidth, r)
export const RowsIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Rows, size, strokeWidth, r)
export const MessageIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(MessageCircle, size, strokeWidth, r)
export const SmileIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Smile, size, strokeWidth, r)
export const PlusIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Plus, size, strokeWidth, r)
export const EditIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Pencil, size, strokeWidth, r)
export const TrashIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Trash2, size, strokeWidth, r)
export const ClockIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Clock, size, strokeWidth, r)
export const LockIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Lock, size, strokeWidth, r)
export const InboxIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Inbox, size, strokeWidth, r)
export const ReceiptIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Receipt, size, strokeWidth, r)
export const CreditCardIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(CreditCard, size, strokeWidth, r)

// SpinnerIcon: lucide's Loader2 is a half-circle arc. Match the old behavior by spinning it via
// the same inline keyframe we used before, so existing callers don't need to add their own.
export const SpinnerIcon = ({ size, strokeWidth, style, ...r }: IconProps) => (
  <>
    <Loader2
      size={size ?? 18}
      strokeWidth={strokeWidth ?? 2}
      aria-hidden
      style={{ animation: 'gx-spin 0.8s linear infinite', ...style }}
      {...(r as any)}
    />
    <style>{`@keyframes gx-spin{to{transform:rotate(360deg)}}`}</style>
  </>
)

export const ServerIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Server, size, strokeWidth, r)
export const CalendarIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Calendar, size, strokeWidth, r)
export const DownloadIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Download, size, strokeWidth, r)
export const PauseIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Pause, size, strokeWidth, r)
export const PlayIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Play, size, strokeWidth, r)
// SnoozeIcon: closest lucide match for a "snoozed bell / Zz clock" is AlarmClock.
export const SnoozeIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(AlarmClock, size, strokeWidth, r)
export const ArchiveIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Archive, size, strokeWidth, r)
// MuteIcon: visually a "bell with a slash" — BellOff is the lucide equivalent.
export const MuteIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(BellOff, size, strokeWidth, r)
export const BookmarkIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Bookmark, size, strokeWidth, r)
export const PinIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Pin, size, strokeWidth, r)
export const HomeIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Home, size, strokeWidth, r)
export const TruckIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Truck, size, strokeWidth, r)
export const FileIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(FileText, size, strokeWidth, r)
export const MapIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Map, size, strokeWidth, r)
export const ShieldIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Shield, size, strokeWidth, r)
export const LayersIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Layers, size, strokeWidth, r)
export const PackageIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Package, size, strokeWidth, r)
export const DollarIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(DollarSign, size, strokeWidth, r)
export const BriefcaseIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Briefcase, size, strokeWidth, r)
export const FolderIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Folder, size, strokeWidth, r)
export const GlobeIcon = ({ size, strokeWidth, ...r }: IconProps) => W(Globe, size, strokeWidth, r)
export const ActivityIcon = ({ size, strokeWidth, ...r }: IconProps) =>
  W(Activity, size, strokeWidth, r)
