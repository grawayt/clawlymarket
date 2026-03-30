import { useState, useEffect } from 'react'

export type ThemeName = 'midnight' | 'lavender' | 'ocean' | 'arctic'

export interface ThemeColors {
  bg: string
  bgCard: string
  border: string
  text: string
  textMuted: string
  textDim: string
  accent: string
  accentMuted: string
}

export const THEMES: Record<ThemeName, { label: string; dot: string; colors: ThemeColors }> = {
  midnight: {
    label: 'Midnight',
    dot: '#ef4444',
    colors: {
      bg: '#0a0a0a', bgCard: '#111111', border: '#1e1e1e',
      text: '#e5e5e5', textMuted: '#999999', textDim: '#555555',
      accent: '#ef4444', accentMuted: 'rgba(239,68,68,0.15)',
    },
  },
  lavender: {
    label: 'Lavender',
    dot: '#a78bfa',
    colors: {
      bg: '#0d0b14', bgCard: '#161225', border: '#2d2640',
      text: '#e8e4f0', textMuted: '#9a8faf', textDim: '#5a4f6e',
      accent: '#a78bfa', accentMuted: 'rgba(167,139,250,0.15)',
    },
  },
  ocean: {
    label: 'Ocean',
    dot: '#60a5fa',
    colors: {
      bg: '#0a0d14', bgCard: '#0f1520', border: '#1e2d40',
      text: '#e0e8f0', textMuted: '#8fa4b8', textDim: '#4a6070',
      accent: '#60a5fa', accentMuted: 'rgba(96,165,250,0.15)',
    },
  },
  arctic: {
    label: 'Arctic',
    dot: '#6366f1',
    colors: {
      bg: '#f8f9fc', bgCard: '#ffffff', border: '#e2e4ea',
      text: '#1e1e2e', textMuted: '#6b7080', textDim: '#a0a4b0',
      accent: '#6366f1', accentMuted: 'rgba(99,102,241,0.1)',
    },
  },
}

const STORAGE_KEY = 'clawly-theme'

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem(STORAGE_KEY) as ThemeName) || 'midnight'
    }
    return 'midnight'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
    const root = document.documentElement
    const colors = THEMES[theme].colors
    root.style.setProperty('--bg', colors.bg)
    root.style.setProperty('--bg-card', colors.bgCard)
    root.style.setProperty('--border', colors.border)
    root.style.setProperty('--text', colors.text)
    root.style.setProperty('--text-muted', colors.textMuted)
    root.style.setProperty('--text-dim', colors.textDim)
    root.style.setProperty('--accent', colors.accent)
    root.style.setProperty('--accent-muted', colors.accentMuted)
    root.setAttribute('data-theme', theme)
  }, [theme])

  return { theme, setTheme: setThemeState, colors: THEMES[theme].colors }
}
