import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  BookMarked,
  BookOpen,
  Boxes,
  CalendarRange,
  Landmark,
  LayoutDashboard,
  PlayCircle,
  Receipt,
  Scale,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserCheck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ScanLine, BadgeCheck } from "lucide-react";
import type { NavIcon as NavIconName } from "@/lib/constants";

/**
 * Icon names are strings in the navigation config so the config stays a plain
 * data file, importable anywhere without dragging the icon library along. The
 * mapping to real components happens here, once.
 */
const ICONS: Record<NavIconName, LucideIcon> = {
  LayoutDashboard,
  ScanLine,
  BadgeCheck,
  Receipt,
  ShoppingCart,
  Boxes,
  UserCheck,
  Truck,
  BookOpen,
  Wallet,
  Landmark,
  BarChart3,
  BookMarked,
  Scale,
  PlayCircle,
  CalendarRange,
  ShieldCheck,
  Settings,
  UserCog,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={className} aria-hidden />;
}
