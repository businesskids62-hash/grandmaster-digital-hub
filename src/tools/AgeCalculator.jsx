import { useState } from 'react';
import { Calendar, Clock, Cake, AlertCircle, Sparkles } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function AgeCalculator() {
  const { isRtl } = useLanguage();
  const [birthDate, setBirthDate] = useState('2000-01-01');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const calculateAge = (e) => {
    e?.preventDefault();
    setError('');

    if (!birthDate) {
      setError(isRtl ? 'براہ کرم تاریخ پیدائش درج کریں۔' : 'Please select a valid date of birth.');
      return;
    }

    const birth = new Date(birthDate);
    const now = new Date();

    if (isNaN(birth.getTime())) {
      setError(isRtl ? 'غلط تاریخ منتخب کی گئی ہے۔' : 'Invalid date format.');
      return;
    }

    if (birth > now) {
      setError(isRtl ? 'تاریخ پیدائش مستقبل کی نہیں ہو سکتی۔' : 'Date of birth cannot be in the future.');
      return;
    }

    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 130);
    if (birth < minDate) {
      setError(isRtl ? 'براہ کرم 130 سال سے کم کی تاریخ درج کریں۔' : 'Please enter a date within the last 130 years.');
      return;
    }

    // Exact years, months, days calculation
    let years = now.getFullYear() - birth.getFullYear();
    let months = now.getMonth() - birth.getMonth();
    let days = now.getDate() - birth.getDate();

    if (days < 0) {
      months -= 1;
      const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      days += prevMonthDays;
    }

    if (months < 0) {
      years -= 1;
      months += 12;
    }

    // Total units
    const diffMs = now - birth;
    const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const totalWeeks = Math.floor(totalDays / 7);
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const totalMonths = years * 12 + months;

    // Day of week born
    const daysOfWeek = [
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
    ];
    const daysOfWeekUr = [
      'اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'
    ];
    const bornDay = isRtl ? daysOfWeekUr[birth.getDay()] : daysOfWeek[birth.getDay()];

    // Next birthday calculation
    let nextBday = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
    if (nextBday < now) {
      nextBday.setFullYear(now.getFullYear() + 1);
    }
    const daysUntilNext = Math.ceil((nextBday - now) / (1000 * 60 * 60 * 24));

    setResult({
      years,
      months,
      days,
      totalMonths,
      totalWeeks,
      totalDays,
      totalHours,
      bornDay,
      daysUntilNext
    });
  };

  return (
    <div className="max-w-xl mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-brand-gold-500" />
            <span>{isRtl ? 'عمر اور سنگ میل کیلکولیٹر' : 'Exact Age & Milestone Calculator'}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl ? 'درست تاریخ کا انتخاب کریں اور زندگی کے لمحات کا حساب لگائیں' : 'Accurate biological age, lived hours, and birthday countdown'}
          </p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
          Validated
        </span>
      </div>

      <form onSubmit={calculateAge} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
            {isRtl ? 'تاریخ پیدائش درج کریں' : 'Select Date of Birth'}
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold-500/40"
            />
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md transition"
            >
              {isRtl ? 'حساب لگائیں' : 'Calculate'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>

      {result && (
        <div className="mt-6 space-y-4 pt-6 border-t border-slate-200 dark:border-brand-navy-700/60">
          {/* Main 3 Blocks */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 rounded-2xl bg-brand-gold-500/10 border border-brand-gold-500/30 text-center">
              <span className="text-3xl font-extrabold text-brand-gold-600 dark:text-brand-gold-400 font-mono">
                {result.years}
              </span>
              <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1 uppercase tracking-wider">
                {isRtl ? 'سال' : 'Years'}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-center">
              <span className="text-3xl font-extrabold text-blue-600 dark:text-blue-400 font-mono">
                {result.months}
              </span>
              <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1 uppercase tracking-wider">
                {isRtl ? 'مہینے' : 'Months'}
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center">
              <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                {result.days}
              </span>
              <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1 uppercase tracking-wider">
                {isRtl ? 'دن' : 'Days'}
              </span>
            </div>
          </div>

          {/* Next Birthday Banner */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 to-brand-gold-500/10 border border-purple-500/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-600 dark:text-purple-400">
                <Cake className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                  {isRtl ? 'اگلی سالگرہ میں باقی دن' : 'Next Birthday Countdown'}
                </span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {result.daysUntilNext} {isRtl ? 'دن باقی ہیں' : 'days left'}
                </span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500 dark:text-slate-400">
              <span className="block font-medium">{isRtl ? 'پیدائش کا دن' : 'Born On'}</span>
              <span className="font-bold text-purple-600 dark:text-purple-400">{result.bornDay}</span>
            </div>
          </div>

          {/* Detailed Statistics Table */}
          <div className="bg-slate-50 dark:bg-brand-navy-900/60 p-4 rounded-2xl border border-slate-200 dark:border-brand-navy-700 space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-brand-navy-800">
              <span className="text-slate-500">{isRtl ? 'کل مہینے' : 'Total Months Lived'}</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{result.totalMonths.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-brand-navy-800">
              <span className="text-slate-500">{isRtl ? 'کل ہفتے' : 'Total Weeks Lived'}</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{result.totalWeeks.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-brand-navy-800">
              <span className="text-slate-500">{isRtl ? 'کل دن' : 'Total Days Lived'}</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{result.totalDays.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">{isRtl ? 'کل گھنٹے (تقریباً)' : 'Total Hours Lived (approx)'}</span>
              <span className="font-mono font-bold text-brand-gold-600 dark:text-brand-gold-400">{result.totalHours.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
