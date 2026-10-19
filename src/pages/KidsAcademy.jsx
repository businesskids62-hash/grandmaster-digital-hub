import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Play, BookOpen, Clock, Tag, ShieldAlert, Sparkles, 
  CheckCircle, ArrowUpRight, Lock, Video 
} from 'lucide-react';
import { coursesData } from '../data/coursesData';
import { useLanguage } from '../hooks/useLanguage';
import { formatCurrencyPKR, formatCurrencyUSD } from '../utils/formatters';
import PaymentDemoModal from '../components/PaymentDemoModal';

export default function KidsAcademy() {
  const { t, lang, isRtl } = useLanguage();
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleEnrollClick = (course) => {
    setSelectedCourse(course);
    setIsModalOpen(true);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-gold-500/10 border border-brand-gold-500/30 text-brand-gold-600 dark:text-brand-gold-400 text-xs font-bold uppercase tracking-wider">
          <BookOpen className="w-3.5 h-3.5" />
          <span>{isRtl ? 'کڈز کوڈنگ اکیڈمی' : 'Next-Gen Young Creator Academy'}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          {t.kids.title}
        </h1>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
          {t.kids.subtitle}
        </p>
      </div>

      {/* Mandatory Disclaimer Box */}
      <div className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="text-xs leading-relaxed space-y-1">
          <p className="font-bold">
            {t.kids.demoNotice}
          </p>
          <p className="text-slate-600 dark:text-amber-300/80">
            {t.kids.buyNotice}
          </p>
        </div>
      </div>

      {/* Courses Grid (6 courses) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {coursesData.map((course) => {
          const title = course.title[lang] || course.title.en;
          const description = course.description[lang] || course.description.en;
          const statusText = isRtl ? course.statusUr : course.status;

          return (
            <motion.div
              key={course.id}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35 }}
              className="group bg-white dark:bg-brand-navy-800/90 rounded-3xl border border-slate-200 dark:border-brand-navy-700 hover:border-brand-gold-500/50 shadow-xl overflow-hidden flex flex-col justify-between transition-all duration-300"
            >
              <div>
                {/* Video Placeholder Container */}
                <div className="relative aspect-video bg-gradient-to-br from-brand-navy-900 via-brand-navy-800 to-slate-900 overflow-hidden flex items-center justify-center group/video">
                  {/* Subtle Grid overlay */}
                  <div className="absolute inset-0 bg-[radial-gradient(#d4af37_1px,transparent_1px)] [background-size:16px_16px] opacity-20" />
                  
                  {/* Play preview icon */}
                  <div className="relative z-10 flex flex-col items-center gap-2 text-center p-4">
                    <div className="w-12 h-12 rounded-full bg-brand-gold-500/20 border border-brand-gold-500/40 text-brand-gold-400 flex items-center justify-center group-hover/video:scale-110 transition-transform">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </div>
                    <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                      {isRtl ? 'ویڈیو پیش نظارہ' : 'Video Placeholder'}
                    </span>
                    <span className="text-[10px] text-slate-400 max-w-[220px] line-clamp-2">
                      {course.videoNotice}
                    </span>
                  </div>

                  {/* Status Badge */}
                  <div className="absolute top-3 right-3 z-20">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border backdrop-blur-sm ${course.badgeColor}`}>
                      {statusText}
                    </span>
                  </div>

                  {/* Age Group */}
                  <div className="absolute bottom-3 left-3 z-20">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-black/60 text-slate-200 backdrop-blur-sm">
                      {course.ageGroup}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-brand-gold-500" />
                      <span>{course.duration}</span>
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {course.level}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-slate-900 dark:text-white group-hover:text-brand-gold-500 transition-colors">
                    {title}
                  </h3>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {description}
                  </p>

                  {/* Highlights */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {course.highlights.map((h, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-brand-navy-900 text-slate-600 dark:text-slate-300"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Price & Action */}
              <div className="p-6 pt-4 border-t border-slate-100 dark:border-brand-navy-700/80 bg-slate-50/50 dark:bg-brand-navy-900/30">
                <div className="flex items-baseline justify-between mb-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                      {isRtl ? 'نمونہ فیس' : 'Sample Tuition'}
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
                        {formatCurrencyPKR(course.pricePKR)}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        ({formatCurrencyUSD(course.priceUSD)})
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    *Sample Price
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleEnrollClick(course)}
                  className="w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 via-brand-gold-400 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md shadow-brand-gold-500/20 hover:shadow-brand-gold-500/30 transition-all flex items-center justify-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'ڈیمو داخلہ لیں' : 'Enroll Now (Demo)'}</span>
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Payment Demo Modal */}
      <PaymentDemoModal
        course={selectedCourse}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
