import { Info, Sparkles } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function DemoNoticeBanner() {
  const { isRtl } = useLanguage();

  return (
    <div className="bg-gradient-to-r from-brand-navy-900 via-brand-navy-800 to-brand-navy-900 border-b border-brand-gold-500/20 text-xs py-2 px-4 text-slate-300">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-gold-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-gold-500"></span>
          </span>
          <span className="font-semibold text-brand-gold-400 uppercase tracking-wider">
            Grandmaster Architecture • Step 2/100
          </span>
          <span className="hidden sm:inline text-slate-400">|</span>
          <span className="text-slate-300">
            {isRtl 
              ? "مرحلہ 2: گرینڈ ماسٹر اے آئی برین فعال ہے۔ بیک اینڈ گیٹ وے منسلک ہے۔"
              : "Step 2: Grandmaster AI Brain interface active. Backend gateway operational. All 10 tools functional."}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-brand-gold-400/90 font-medium">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Learn • Build • Earn</span>
        </div>
      </div>
    </div>
  );
}
