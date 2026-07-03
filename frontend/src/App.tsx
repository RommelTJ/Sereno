import { BrowserRouter, Route, Routes } from 'react-router'
import Header from './components/Header.tsx'
import Sidebar from './components/Sidebar.tsx'
import Dashboard from './views/Dashboard.tsx'

function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="w-full max-w-[1180px] px-9 pt-[30px] pb-[60px]">
            <Routes>
              <Route path="/" element={<Dashboard />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  )
}

export default App
