import { Link } from 'react-router-dom';
import { Crown, Home, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function NotFound() {
  const { isRtl } = useLanguage();

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-16 text-center">
      <div className="max-w-md mx-auto space-y-6">
        <div className="w-16 h-16 mx-auto rounded-3xl bg-brand-gold-500/10 text-brand-gold-500 flex items-center justify-center">
          <Crown className="w-8 h-8" />
        </div>
        <h1 className="text-5xl font-black font-mono text-slate-900 dark:text-white">
          404
        </h1>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">
          {isRtl ? 'صفحہ نہیں ملا' : 'Module Route Not Found'}
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          {isRtl 
            ? 'آپ جس صفحے کو تلاش کر رہے ہیں وہ اس وقت دستیاب نہیں ہے یا اگلے مرحلے میں بنایا جائے گا۔'
            : 'The requested route does not exist or is reserved for future Grandmaster architecture milestones.'}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-brand-gold-500 text-brand-navy-900 hover:bg-brand-gold-400 transition shadow-md"
        >
          <Home className="w-4 h-4" />
          <span>{isRtl ? 'ہوم پیج پر واپس جائیں' : 'Back to Hub Home'}</span>
        </Link>
      </div>
    </div>
  );
}
