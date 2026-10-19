import { Link } from 'react-router-dom';
import { Crown, Heart, Shield, Terminal, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function Footer() {
  const { t, isRtl } = useLanguage();

  return (
    <footer className="bg-brand-navy-900 border-t border-brand-navy-800 text-slate-400 py-12 px-4 sm:px-6 lg:px-8 mt-auto">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Brand Column */}
        <div className="md:col-span-2 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-gold-400 to-amber-600 flex items-center justify-center text-brand-navy-900 font-black shadow-lg shadow-brand-gold-500/20">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xl font-extrabold text-white tracking-tight">
                {t.brand}
              </span>
              <p className="text-xs font-semibold text-brand-gold-400 tracking-wider">
                {t.tagline}
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-400 max-w-md leading-relaxed">
            {t.footer.tagline}
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-navy-800/80 border border-brand-gold-500/20 text-xs text-brand-gold-400">
            <Terminal className="w-3.5 h-3.5" />
            <span>Architecture: Step 1 / 100 Foundation</span>
          </div>
        </div>

        {/* Quick Links */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
            {t.footer.quickLinks}
          </h4>
          <ul className="space-y-2 text-sm">
            <li>
              <Link to="/" className="hover:text-brand-gold-400 transition flex items-center gap-1">
                <span>{t.nav.home}</span>
              </Link>
            </li>
            <li>
              <Link to="/grandmaster" className="hover:text-brand-gold-400 transition flex items-center gap-1">
                <span>{t.nav.grandmaster}</span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-brand-gold-500/10 text-brand-gold-400 border border-brand-gold-500/20">Step 2 AI</span>
              </Link>
            </li>
            <li>
              <Link to="/kids" className="hover:text-brand-gold-400 transition flex items-center gap-1">
                <span>{t.nav.kids}</span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-brand-gold-500/10 text-brand-gold-400 border border-brand-gold-500/20">6 Courses</span>
              </Link>
            </li>
            <li>
              <Link to="/tools" className="hover:text-brand-gold-400 transition flex items-center gap-1">
                <span>{t.nav.tools}</span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">10 Tools</span>
              </Link>
            </li>
            <li>
              <Link to="/dashboard" className="hover:text-brand-gold-400 transition flex items-center gap-1">
                <span>{t.nav.dashboard}</span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Demo</span>
              </Link>
            </li>
          </ul>
        </div>

        {/* Ecosystem Transparency */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-brand-gold-400" />
            <span>Transparency & Scope</span>
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            {t.footer.disclaimer}
          </p>
          <div className="pt-2 text-xs text-slate-500 border-t border-brand-navy-800">
            {t.footer.builtWith}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-10 pt-6 border-t border-brand-navy-800 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          © {new Date().getFullYear()} {t.brand}. {t.footer.legal}
        </div>
        <div className="flex items-center gap-1 text-slate-400">
          <span>Engineered for Grandmaster AI Ecosystem</span>
        </div>
      </div>
    </footer>
  );
}
