import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Crown, Menu, X, BookOpen, Wrench, LayoutDashboard, Sparkles, ChevronRight, Bot } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t, isRtl } = useLanguage();

  const navLinks = [
    { to: '/', label: t.nav.home, icon: Sparkles },
    { to: '/grandmaster', label: t.nav.grandmaster, icon: Bot },
    { to: '/kids', label: t.nav.kids, icon: BookOpen },
    { to: '/tools', label: t.nav.tools, icon: Wrench },
    { to: '/dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
  ];

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-white/90 dark:bg-brand-navy-900/90 border-b border-slate-200/80 dark:border-brand-navy-700/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Brand Logo & Tagline */}
          <Link
            to="/"
            onClick={closeMenu}
            className="flex items-center gap-3 group focus:outline-none"
          >
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-gold-400 via-brand-gold-500 to-amber-600 flex items-center justify-center shadow-lg shadow-brand-gold-500/20 group-hover:scale-105 transition-transform duration-200">
              <Crown className="w-6 h-6 text-brand-navy-900" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg sm:text-xl tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>{t.brand}</span>
              </span>
              <span className="text-xs font-semibold text-brand-gold-600 dark:text-brand-gold-400 tracking-wider">
                {t.tagline}
              </span>
            </div>
          </Link>

          {/* Desktop Nav Items */}
          <nav className="hidden md:flex items-center gap-1 lg:gap-2">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    `px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                      isActive
                        ? 'bg-brand-gold-500/15 text-brand-gold-600 dark:text-brand-gold-400 font-semibold border border-brand-gold-500/30 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-brand-navy-800'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  <span>{link.label}</span>
                </NavLink>
              );
            })}
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-3">
            <LanguageToggle />
            <ThemeToggle />
            <Link
              to="/tools"
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-gradient-to-r from-brand-gold-500 via-brand-gold-400 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md shadow-brand-gold-500/20 hover:shadow-brand-gold-500/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              {t.nav.getStarted}
            </Link>
          </div>

          {/* Mobile Menu & Toggles Button */}
          <div className="flex items-center gap-2 md:hidden">
            <LanguageToggle />
            <ThemeToggle />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              className="p-2 rounded-xl border border-slate-200 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-brand-navy-700"
              aria-label="Open mobile navigation"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 dark:border-brand-navy-800 bg-white dark:bg-brand-navy-900 px-4 pt-3 pb-6 space-y-2">
          {navLinks.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={closeMenu}
                className={({ isActive }) =>
                  `flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? 'bg-brand-gold-500/15 text-brand-gold-600 dark:text-brand-gold-400 font-bold border border-brand-gold-500/30'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-navy-800'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-brand-gold-500" />
                  <span>{link.label}</span>
                </div>
                <ChevronRight className={`w-4 h-4 text-slate-400 ${isRtl ? 'rotate-180' : ''}`} />
              </NavLink>
            );
          })}
          <div className="pt-2">
            <Link
              to="/tools"
              onClick={closeMenu}
              className="block w-full text-center py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-gradient-to-r from-brand-gold-500 to-amber-500 text-brand-navy-900 shadow-md"
            >
              {t.nav.getStarted}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
