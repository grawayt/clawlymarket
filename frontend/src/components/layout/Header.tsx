import { Link, useLocation } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/markets', label: 'Markets' },
  { to: '/verify', label: 'Verify' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/admin', label: 'Admin' },
]

export default function Header() {
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-40 border-b border-[#222] bg-[#0a0a0a]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Wordmark */}
        <Link to="/" className="text-sm font-mono text-gray-200 hover:text-white transition-colors">
          <span className="text-red-500">Clawly</span>
          <span>Market</span>
        </Link>

        {/* Nav + wallet */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, label }) => {
            const isActive = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={`relative px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {label}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-px bg-red-500" />
                )}
              </Link>
            )
          })}

          <div className="ml-3">
            <ConnectButton showBalance={false} />
          </div>
        </nav>
      </div>
    </header>
  )
}
