import { Link, useLocation } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/markets', label: 'Markets' },
  { to: '/verify', label: 'Verify' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/admin', label: 'Admin' },
]

// Claw/lobster icon — simple SVG mark
function ClawIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-red-500 shrink-0"
    >
      {/* Stylised claw / pincer mark */}
      <path
        d="M12 3C9.5 3 7 5 7 8c0 2 1 3.5 2.5 4.5L8 20h8l-1.5-7.5C16 11.5 17 10 17 8c0-3-2.5-5-5-5z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 8.5C8.5 7.5 7 7 5.5 7.5S3 9 3.5 10.5 5.5 13 7 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14.5 8.5C15.5 7.5 17 7 18.5 7.5S21 9 20.5 10.5 18.5 13 17 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function Header() {
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#07070f]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <ClawIcon />
          <span className="text-xl font-bold tracking-tight">
            <span className="text-red-500 group-hover:text-red-400 transition-colors">Clawly</span>
            <span className="text-gray-100">Market</span>
          </span>
        </Link>

        {/* Nav + wallet */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, label }) => {
            const isActive = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={`relative px-3 py-1.5 text-sm rounded-lg transition-all duration-150 ${
                  isActive
                    ? 'text-white font-medium bg-white/[0.07]'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                }`}
              >
                {label}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/5 h-[2px] bg-red-500 rounded-full" />
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
