import { useLanguage } from '../hooks/useLanguage';
import { Languages } from 'lucide-react';

export default function LanguageToggle({ className = "" }) {
  const { lang, toggleLanguage } = useLanguage();

  return (
    <button
      onClick={toggleLanguage}
      type="button"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 border border-slate-200 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-800 text-slate-700 dark:text-slate-200 hover:border-brand-gold-500/50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-gold-500/30 ${className}`}
      aria-label="Toggle Language English / Urdu"
      title="Switch Language (English / اردو)"
    >
      <Languages className="w-4 h-4 text-brand-gold-500" />
      <span>{lang === 'en' ? 'اردو' : 'English'}</span>
    </button>
  );
}
