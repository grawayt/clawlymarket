import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Home from './pages/Home'
import Markets from './pages/Markets'
import MarketDetail from './pages/MarketDetail'
import Portfolio from './pages/Portfolio'
import Leaderboard from './pages/Leaderboard'
import Admin from './pages/Admin'

const Verify = lazy(() => import('./pages/Verify'))

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/markets/:address" element={<MarketDetail />} />
        <Route path="/verify" element={<Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>}><Verify /></Suspense>} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Layout>
  )
}
