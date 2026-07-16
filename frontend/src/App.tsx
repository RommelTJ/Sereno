import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import Header from './components/Header.tsx'
import Sidebar from './components/Sidebar.tsx'
import NetWorthProvider from './components/NetWorthProvider.tsx'
import BudgetReport from './views/BudgetReport.tsx'
import Dashboard from './views/Dashboard.tsx'
import Forecast from './views/Forecast.tsx'
import Funds from './views/Funds.tsx'
import Guardrails from './views/Guardrails.tsx'
import Ledger from './views/Ledger.tsx'
import SafeToSpend from './views/SafeToSpend.tsx'
import Settings from './views/Settings.tsx'
import Withdrawals from './views/Withdrawals.tsx'

function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <BrowserRouter>
      <NetWorthProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          {menuOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="fixed inset-0 z-20 flex lg:hidden"
            >
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="absolute inset-0 bg-black/40"
              />
              <div className="relative">
                <Sidebar variant="drawer" onNavigate={() => setMenuOpen(false)} />
              </div>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <Header onMenuOpen={() => setMenuOpen(true)} />
            <main className="mx-auto w-full max-w-[1180px] px-4 pt-[30px] pb-[60px] sm:px-9">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/ledger" element={<Ledger />} />
                <Route path="/safe-to-spend" element={<SafeToSpend />} />
                <Route path="/report" element={<BudgetReport />} />
                <Route path="/funds" element={<Funds />} />
                <Route path="/guardrails" element={<Guardrails />} />
                <Route path="/withdrawals" element={<Withdrawals />} />
                <Route path="/forecast" element={<Forecast />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </main>
          </div>
        </div>
      </NetWorthProvider>
    </BrowserRouter>
  )
}

export default App
