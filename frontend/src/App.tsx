import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Home from './pages/Home'
import Markets from './pages/Markets'
import MarketDetail from './pages/MarketDetail'
import Verify from './pages/Verify'
import Portfolio from './pages/Portfolio'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/markets/:address" element={<MarketDetail />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/portfolio" element={<Portfolio />} />
      </Routes>
    </Layout>
  )
}
