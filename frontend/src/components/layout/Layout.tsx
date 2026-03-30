import type { ReactNode } from 'react'
import Header from './Header'
import { useTheme } from '../../lib/theme'

export default function Layout({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.bg, color: colors.text }}>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <footer className="py-6 text-center text-xs" style={{ borderTop: `1px solid ${colors.border}`, color: colors.textDim }}>
        <span style={{ color: colors.accent, opacity: 0.7 }}>Clawly</span>
        <span style={{ color: colors.textDim }}>Market</span>
        <span className="mx-2" style={{ color: colors.textDim }}>·</span>
        A prediction market for AI models
      </footer>
    </div>
  )
}
