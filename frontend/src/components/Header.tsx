import { useLocation } from 'react-router'
import { NAV_ITEMS } from '../nav.ts'

function Header() {
  const { pathname } = useLocation()
  const item = NAV_ITEMS.find((navItem) => navItem.path === pathname)

  return (
    <header className="sticky top-0 z-10 border-b border-card-border bg-header px-9 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[21px] font-bold">{item?.title ?? 'Sereno'}</h1>
          <p className="text-sm text-muted">{item?.subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
              Net worth
            </p>
            <p className="num text-lg font-bold">$—</p>
          </div>
          <div
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-full bg-sidebar font-bold text-hero-green"
          >
            S
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
