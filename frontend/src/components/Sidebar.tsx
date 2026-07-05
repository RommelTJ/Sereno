import { NavLink } from 'react-router'
import { NAV_GROUPS } from '../nav.ts'

interface SidebarProps {
  variant?: 'desktop' | 'drawer'
  onNavigate?: () => void
}

function Sidebar({ variant = 'desktop', onNavigate }: SidebarProps) {
  const month = new Date().toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const layout =
    variant === 'drawer'
      ? 'flex h-full w-[248px] flex-col bg-sidebar px-4 py-5'
      : 'sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-sidebar px-4 py-5 lg:flex'

  return (
    <nav aria-label="Primary" className={layout}>
      <div className="flex items-center gap-2.5 px-2">
        <div className="flex size-[30px] items-center justify-center rounded-tile bg-accent font-bold text-white">
          S
        </div>
        <span className="text-[17px] font-bold text-white">Sereno</span>
      </div>
      <div className="mt-7 flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.header} className="mb-5">
            <p className="px-3 pb-2 text-[10.5px] font-semibold tracking-[1.4px] text-sidebar-muted-2 uppercase">
              {group.header}
            </p>
            <ul>
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 border-l-[3px] px-3 py-2 text-sm ${
                        isActive
                          ? 'border-accent bg-sidebar-active/38 font-semibold text-white'
                          : 'border-transparent text-sidebar-text hover:text-white'
                      }`
                    }
                  >
                    <item.icon className="size-4" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="rounded-input bg-sidebar-active/38 px-3 py-2 text-xs text-sidebar-muted">
        {month}
      </div>
    </nav>
  )
}

export default Sidebar
