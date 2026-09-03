import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

type ThemeToggleProps = {
  className?: string
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { isDark, toggleDark } = useTheme()

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleDark}
      title={isDark ? 'Light mode' : 'Dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
    </button>
  )
}
