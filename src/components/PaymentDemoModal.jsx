import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldAlert, CheckCircle, CreditCard, Lock } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { formatCurrencyPKR, formatCurrencyUSD } from '../utils/formatters';

export default function PaymentDemoModal({ course, isOpen, onClose }) {
  const { lang, isRtl } = useLanguage();
  const [simulatedSuccess, setSimulatedSuccess] = useState(false);

  if (!isOpen || !course) return null;

  const handleSimulate = (e) => {
    e.preventDefault();
    setSimulatedSuccess(true);
  };

  const handleClose = () => {
    setSimulatedSuccess(false);
    onClose();
  };

  const courseTitle = course.title[lang] || course.title.en;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-lg bg-white dark:bg-brand-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-brand-navy-700 overflow-hidden"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-brand-navy-700 bg-slate-50 dark:bg-brand-navy-900/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">
                  {isRtl ? 'کورس میں داخلہ ڈیمو' : 'Course Enrollment Demo'}
                </h3>
                <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold uppercase tracking-wider">
                  {isRtl ? 'ڈیمو موڈ • ادائیگی غیر فعال' : 'Demo Mode • No Real Charges'}
                </span>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-brand-navy-700 transition"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            {/* Caution Alert */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-800 dark:text-amber-300">
              <ShieldAlert className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-xs leading-relaxed">
                <strong className="block font-semibold mb-0.5">
                  {isRtl ? 'ادائیگی کا گیٹ وے ابھی منسلک نہیں ہے' : 'Payment Gateway Inactive (Step 1 Foundation)'}
                </strong>
                {isRtl
                  ? 'یہ صرف نمائشی پریویو ہے۔ کوئی ادائیگی یا کارڈ چارج نہیں کیا جا رہا ہے۔ باقاعدہ ادائیگی کا نظام آئندہ مراحل میں شامل کیا جائے گا۔'
                  : 'Live payment processing (Stripe, JazzCash, Easypaisa, Bank Transfer) will be connected in future ecosystem steps. No card is charged and no real transaction occurs.'}
              </div>
            </div>

            {/* Course Summary */}
            <div className="bg-slate-50 dark:bg-brand-navy-900/40 p-4 rounded-xl border border-slate-200 dark:border-brand-navy-700/60 space-y-2">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {courseTitle}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{course.duration}</span>
                <span className="font-semibold text-brand-gold-600 dark:text-brand-gold-400 text-sm">
                  {formatCurrencyPKR(course.pricePKR)} / {formatCurrencyUSD(course.priceUSD)}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 italic">
                * {isRtl ? 'یہ قیمت صرف نمونے کے طور پر دکھائی گئی ہے۔' : 'Sample pricing for architectural demonstration only.'}
              </div>
            </div>

            {simulatedSuccess ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-center space-y-2"
              >
                <CheckCircle className="w-8 h-8 mx-auto text-emerald-500" />
                <h4 className="font-bold text-sm">
                  {isRtl ? 'ڈیمو داخلہ سمیولیشن کامیاب!' : 'Demo Enrollment Simulated!'}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {isRtl
                    ? 'آپ کا ڈیمو اندراج رجسٹر ہو گیا ہے۔ باضابطہ کورس پورٹل لانچ ہونے پر آپ کو نوٹیفکیشن موصول ہوگی۔'
                    : 'Your sample enrollment intent has been recorded in client state. You will receive access once the Grandmaster backend is deployed.'}
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg transition"
                >
                  {isRtl ? 'ٹھیک ہے، بند کریں' : 'Got it, Close'}
                </button>
              </motion.div>
            ) : (
              <form onSubmit={handleSimulate} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isRtl ? 'والدین یا طالب علم کا نام (ڈیمو)' : 'Student / Parent Name (Demo)'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={isRtl ? 'مثال: علی احمد' : 'e.g., Alex Johnson'}
                    defaultValue="Grandmaster Demo Learner"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-gold-500/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isRtl ? 'رابطہ ای میل (ڈیمو)' : 'Contact Email (Demo)'}
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="learner@example.com"
                    defaultValue="learner@grandmasterhub.local"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-gold-500/40"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-brand-navy-700 transition"
                  >
                    {isRtl ? 'منسوخ کریں' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-brand-gold-500 to-brand-gold-600 hover:from-brand-gold-400 hover:to-brand-gold-500 text-brand-navy-900 transition shadow-md"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{isRtl ? 'ڈیمو اندراج کی تصدیق کریں' : 'Simulate Demo Enrollment'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
