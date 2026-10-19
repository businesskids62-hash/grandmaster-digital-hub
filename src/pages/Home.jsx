import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Crown, Sparkles, BookOpen, Wrench, Package, 
  ArrowRight, ShieldCheck, Cpu, Code2, Users, CheckCircle2, Bot 
} from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function Home() {
  const { t, isRtl } = useLanguage();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.12 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } }
  };

  return (
    <div className="space-y-16 sm:space-y-24 pb-20">
      {/* HERO SECTION */}
      <section className="relative overflow-hidden pt-12 sm:pt-20 lg:pt-28">
        {/* Ambient Gradient Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 sm:w-[650px] h-96 sm:h-[650px] bg-brand-gold-500/10 dark:bg-brand-gold-500/15 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute top-10 right-10 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-gold-500/10 border border-brand-gold-500/30 text-brand-gold-600 dark:text-brand-gold-400 text-xs font-bold tracking-wide uppercase mb-6 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t.hero.badge}</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-900 dark:text-white max-w-5xl mx-auto leading-[1.15]"
          >
            <span>{t.brand}</span>
            <span className="block mt-2 text-transparent bg-clip-text bg-gradient-to-r from-brand-gold-500 via-amber-400 to-brand-gold-600">
              {t.tagline}
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-6 text-base sm:text-xl text-slate-600 dark:text-slate-300 max-w-3xl mx-auto leading-relaxed"
          >
            {t.hero.subtitle}
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
          >
            <Link
              to="/grandmaster"
              className="px-8 py-3.5 rounded-2xl font-extrabold text-sm uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 via-brand-gold-400 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-xl shadow-brand-gold-500/25 hover:shadow-brand-gold-500/40 transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
            >
              <Bot className="w-4 h-4" />
              <span>Launch Grandmaster AI</span>
            </Link>

            <Link
              to="/kids"
              className="px-7 py-3.5 rounded-2xl font-bold text-sm uppercase tracking-wider bg-white dark:bg-brand-navy-800 text-slate-800 dark:text-white border border-slate-300 dark:border-brand-navy-700 hover:border-brand-gold-500/50 hover:bg-slate-50 dark:hover:bg-brand-navy-700/80 shadow-md transition-all flex items-center gap-2"
            >
              <BookOpen className="w-4 h-4 text-brand-gold-500" />
              <span>{t.hero.ctaPrimary}</span>
            </Link>

            <Link
              to="/tools"
              className="px-7 py-3.5 rounded-2xl font-bold text-sm uppercase tracking-wider bg-white dark:bg-brand-navy-800 text-slate-800 dark:text-white border border-slate-300 dark:border-brand-navy-700 hover:border-brand-gold-500/50 hover:bg-slate-50 dark:hover:bg-brand-navy-700/80 shadow-md transition-all flex items-center gap-2"
            >
              <Wrench className="w-4 h-4 text-brand-gold-500" />
              <span>{t.hero.ctaSecondary}</span>
            </Link>

            <Link
              to="/dashboard"
              className="px-5 py-3.5 rounded-2xl font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition flex items-center gap-1.5"
            >
              <span>{t.hero.ctaDashboard}</span>
              <ArrowRight className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
            </Link>
          </motion.div>

          {/* Micro Stats Bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="mt-12 pt-8 border-t border-slate-200/80 dark:border-brand-navy-800/80 max-w-4xl mx-auto grid grid-cols-3 gap-4 text-center"
          >
            <div>
              <span className="text-xl sm:text-2xl font-extrabold text-brand-gold-500 font-mono">6</span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{t.hero.statCourses}</p>
            </div>
            <div>
              <span className="text-xl sm:text-2xl font-extrabold text-brand-gold-500 font-mono">10</span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{t.hero.statTools}</p>
            </div>
            <div>
              <span className="text-xl sm:text-2xl font-extrabold text-brand-gold-500 font-mono">100%</span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{t.hero.statUptime}</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CORE 3 PILLAR MODULE CARDS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {t.homeCards.sectionTitle}
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
            {t.homeCards.sectionSubtitle}
          </p>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          {/* Card 1: Kids Coding Courses */}
          <motion.div
            variants={itemVariants}
            className="group relative p-8 rounded-3xl bg-white dark:bg-brand-navy-800/90 border border-slate-200 dark:border-brand-navy-700 hover:border-brand-gold-500/50 shadow-xl transition-all duration-300 flex flex-col justify-between"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-brand-gold-500/10 text-brand-gold-500 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <BookOpen className="w-7 h-7" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-brand-gold-600 dark:text-brand-gold-400">
                Pillar 01 • Education
              </span>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mt-1 mb-3">
                {t.homeCards.kidsTitle}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {t.homeCards.kidsDesc}
              </p>

              <ul className="mt-6 space-y-2 text-xs text-slate-500 dark:text-slate-400">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Scratch, Python, AI, Roblox, YouTube & Business</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Dual PKR & USD transparent sample pricing</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Curriculum preview and safe enrollment simulation</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-brand-navy-700/80">
              <Link
                to="/kids"
                className="inline-flex items-center justify-between w-full text-sm font-bold text-brand-gold-600 dark:text-brand-gold-400 group-hover:translate-x-1 transition-transform"
              >
                <span>{t.homeCards.kidsCta}</span>
                <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
              </Link>
            </div>
          </motion.div>

          {/* Card 2: Business & Productivity Tools */}
          <motion.div
            variants={itemVariants}
            className="group relative p-8 rounded-3xl bg-white dark:bg-brand-navy-800/90 border border-brand-gold-500/40 dark:border-brand-gold-500/40 shadow-2xl transition-all duration-300 flex flex-col justify-between ring-1 ring-brand-gold-500/20"
          >
            <div className="absolute -top-3.5 right-6 px-3 py-1 rounded-full bg-brand-gold-500 text-brand-navy-900 font-extrabold text-[10px] uppercase tracking-wider shadow-md">
              10 Working Tools
            </div>

            <div>
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Wrench className="w-7 h-7" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Pillar 02 • Utilities
              </span>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mt-1 mb-3">
                {t.homeCards.toolsTitle}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {t.homeCards.toolsDesc}
              </p>

              <ul className="mt-6 space-y-2 text-xs text-slate-500 dark:text-slate-400">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Invoice & Resume printable document generators</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Real QR code, canvas image compressor & crypto keys</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>100% client-side privacy with zero server uploads</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-brand-navy-700/80">
              <Link
                to="/tools"
                className="inline-flex items-center justify-between w-full text-sm font-bold text-brand-gold-600 dark:text-brand-gold-400 group-hover:translate-x-1 transition-transform"
              >
                <span>{t.homeCards.toolsCta}</span>
                <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
              </Link>
            </div>
          </motion.div>

          {/* Card 3: Grandmaster AI Brain */}
          <motion.div
            variants={itemVariants}
            className="group relative p-8 rounded-3xl bg-white dark:bg-brand-navy-800/90 border border-brand-gold-500/40 dark:border-brand-gold-500/40 shadow-xl transition-all duration-300 flex flex-col justify-between"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 text-purple-500 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Bot className="w-7 h-7" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Pillar 03 • Intelligence
              </span>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mt-1 mb-3">
                Grandmaster AI Brain
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Interactive strategic digital mentor. Ask questions, explore code architectures, plan roadmaps, and receive guidance in English & Roman Urdu.
              </p>

              <div className="mt-6 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-800 dark:text-purple-300">
                <p className="font-semibold">Step 2 AI Gateway Active</p>
                <span className="text-[11px] text-slate-500 dark:text-purple-400 mt-1 block">
                  Backend API gateway with Google Gemini adapter & browser conversation persistence.
                </span>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-brand-navy-700/80">
              <Link
                to="/grandmaster"
                className="inline-flex items-center justify-between w-full text-sm font-bold text-brand-gold-600 dark:text-brand-gold-400 group-hover:translate-x-1 transition-transform"
              >
                <span>Launch Grandmaster Chat</span>
                <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
              </Link>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ARCHITECTURAL TRANSPARENCY SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-br from-brand-navy-900 via-brand-navy-800 to-brand-navy-900 text-white border border-brand-gold-500/30 shadow-2xl relative overflow-hidden">
          <div className="relative z-10 max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-brand-gold-500/20 border border-brand-gold-500/40 text-brand-gold-400 text-xs font-bold">
              <Cpu className="w-4 h-4" />
              <span>Architectural Blueprint • Step 1 of 100</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Built with Clean Boundaries for Future AI Superminds
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Step 1 establishes the rock-solid frontend core. Every tool runs client-side with real JavaScript mechanics. In subsequent milestones, backend persistence, auth layers, payment gateways, and autonomous robots will seamlessly slot into this architecture.
            </p>
            <div className="pt-2 flex flex-wrap gap-4 text-xs font-mono text-brand-gold-400">
              <span className="px-3 py-1 rounded-md bg-brand-navy-800 border border-brand-navy-700">✓ React 18 & Vite</span>
              <span className="px-3 py-1 rounded-md bg-brand-navy-800 border border-brand-navy-700">✓ Tailwind CSS Dark/Light</span>
              <span className="px-3 py-1 rounded-md bg-brand-navy-800 border border-brand-navy-700">✓ English / Urdu RTL</span>
              <span className="px-3 py-1 rounded-md bg-brand-navy-800 border border-brand-navy-700">✓ Chart.js Analytics</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
