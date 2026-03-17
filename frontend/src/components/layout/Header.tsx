import { Link, useLocation } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/markets', label: 'Markets' },
  { to: '/verify', label: 'Verify' },
  { to: '/portfolio', label: 'Portfolio' },
]

export default function Header() {
  const { pathname } = useLocation()

  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-xl font-bold text-red-500">
          ClawlyMarket
        </Link>

        <nav className="flex items-center gap-6">
          {NAV_ITEMS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`text-sm transition-colors ${
                pathname === to
                  ? 'text-red-400 font-medium'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </Link>
          ))}
          <ConnectButton showBalance={false} />
        </nav>
      </div>
    </header>
  )
}
