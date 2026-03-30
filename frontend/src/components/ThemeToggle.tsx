import { THEMES, useTheme } from '../lib/theme'
import type { ThemeName } from '../lib/theme'

const themeOrder: ThemeName[] = ['midnight', 'lavender', 'ocean', 'arctic']

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center gap-1.5">
      {themeOrder.map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          title={THEMES[t].label}
          className="relative w-4 h-4 rounded-full transition-transform hover:scale-125"
          style={{
            backgroundColor: THEMES[t].dot,
            opacity: theme === t ? 1 : 0.35,
            boxShadow: theme === t ? `0 0 0 2px ${THEMES[t].dot}40` : 'none',
          }}
        />
      ))}
    </div>
  )
}
