import type { ReactNode } from 'react'
import Header from './Header'
import WrongNetworkBanner from './WrongNetworkBanner'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300">
      <Header />
      <WrongNetworkBanner />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-[#1a1a1a] py-6 text-center text-xs text-gray-700">
        <span className="text-red-600/70">Clawly</span>
        <span className="text-gray-700">Market</span>
        <span className="mx-2 text-gray-800">·</span>
        A prediction market for AI models
      </footer>
    </div>
  )
}
