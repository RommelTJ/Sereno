import { BrowserRouter, Route, Routes } from 'react-router'
import Header from './components/Header.tsx'
import Sidebar from './components/Sidebar.tsx'
import NetWorthProvider from './components/NetWorthProvider.tsx'
import Dashboard from './views/Dashboard.tsx'
import Forecast from './views/Forecast.tsx'
import Funds from './views/Funds.tsx'
import Guardrails from './views/Guardrails.tsx'
import Ledger from './views/Ledger.tsx'
import SafeToSpend from './views/SafeToSpend.tsx'
import Settings from './views/Settings.tsx'
import Withdrawals from './views/Withdrawals.tsx'

function App() {
  return (
    <BrowserRouter>
      <NetWorthProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="w-full max-w-[1180px] px-9 pt-[30px] pb-[60px]">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/ledger" element={<Ledger />} />
                <Route path="/safe-to-spend" element={<SafeToSpend />} />
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
