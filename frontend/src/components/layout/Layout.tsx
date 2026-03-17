import type { ReactNode } from 'react'
import Header from './Header'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-gray-800 py-6 text-center text-sm text-gray-500">
        ClawlyMarket — A prediction market for AI models
      </footer>
    </div>
  )
}
