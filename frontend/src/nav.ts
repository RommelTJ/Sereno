import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownUp,
  CalendarRange,
  Database,
  Gauge,
  LayoutDashboard,
  NotebookPen,
  PiggyBank,
  TrendingUp,
  Wallet,
} from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  title: string
  subtitle: string
  icon: LucideIcon
}

export interface NavGroup {
  header: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    header: 'TRACK',
    items: [
      {
        path: '/',
        label: 'Dashboard',
        title: 'Dashboard',
        subtitle: 'Your money at a glance',
        icon: LayoutDashboard,
      },
      {
        path: '/ledger',
        label: 'Ledger entries',
        title: 'Ledger entries',
        subtitle: 'One row per month per account',
        icon: NotebookPen,
      },
      {
        path: '/safe-to-spend',
        label: 'Safe-to-spend',
        title: 'Safe-to-spend',
        subtitle: 'Total cash − bills due − money in funds',
        icon: Wallet,
      },
      {
        path: '/report',
        label: 'Budget report',
        title: 'Budget report',
        subtitle: 'Planned vs. actual, month by month',
        icon: CalendarRange,
      },
      {
        path: '/funds',
        label: 'Funds & goals',
        title: 'Funds & goals',
        subtitle: 'Sinking funds and dated goals as one concept',
        icon: PiggyBank,
      },
    ],
  },
  {
    header: 'PLAN',
    items: [
      {
        path: '/guardrails',
        label: 'Guardrails',
        title: 'Spending guardrails',
        subtitle: 'Guyton-Klinger withdrawal-rate bands',
        icon: Gauge,
      },
      {
        path: '/withdrawals',
        label: 'Withdrawal sourcing',
        title: 'Withdrawal sourcing',
        subtitle: 'A tax-aware sequencing waterfall',
        icon: ArrowDownUp,
      },
      {
        path: '/forecast',
        label: 'Longevity forecast',
        title: 'Longevity forecast',
        subtitle: 'Does the money last?',
        icon: TrendingUp,
      },
    ],
  },
  {
    header: 'SETTINGS',
    items: [
      {
        path: '/settings',
        label: 'Settings & data',
        title: 'Settings & data',
        subtitle: 'Assumptions, categories, and your data',
        icon: Database,
      },
    ],
  },
]

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items)
