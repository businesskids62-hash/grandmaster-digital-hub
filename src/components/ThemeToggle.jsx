import { useTheme } from '../hooks/useTheme';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ className = "" }) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className={`p-2 rounded-xl transition-all duration-200 border border-slate-200 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-800 text-slate-700 dark:text-brand-gold-400 hover:border-brand-gold-500/50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-gold-500/30 ${className}`}
      aria-label="Toggle Dark and Light Mode"
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
    >
      {isDark ? (
        <Sun className="w-5 h-5 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="w-5 h-5 transition-transform hover:-rotate-12" />
      )}
    </button>
  );
}
