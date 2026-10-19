import { useState } from 'react';
import { 
  Calculator as CalcIcon, Calendar, QrCode, ImageDown, Volume2, 
  Youtube, KeyRound, Receipt, FileText, Scissors, Wrench, Shield, CheckCircle 
} from 'lucide-react';
import { toolsData } from '../data/toolsData';
import { useLanguage } from '../hooks/useLanguage';

// Tool Components
import Calculator from '../tools/Calculator';
import AgeCalculator from '../tools/AgeCalculator';
import QRCodeGenerator from '../tools/QRCodeGenerator';
import ImageCompressor from '../tools/ImageCompressor';
import TextToSpeech from '../tools/TextToSpeech';
import YouTubeThumbnailDownloader from '../tools/YouTubeThumbnailDownloader';
import PasswordGenerator from '../tools/PasswordGenerator';
import InvoiceMaker from '../tools/InvoiceMaker';
import ResumeBuilder from '../tools/ResumeBuilder';
import BackgroundRemover from '../tools/BackgroundRemover';

const iconMap = {
  Calculator: CalcIcon,
  Calendar: Calendar,
  QrCode: QrCode,
  ImageDown: ImageDown,
  Volume2: Volume2,
  Youtube: Youtube,
  KeyRound: KeyRound,
  Receipt: Receipt,
  FileText: FileText,
  Scissors: Scissors,
};

export default function DigitalTools() {
  const { t, lang, isRtl } = useLanguage();
  const [activeToolId, setActiveToolId] = useState('calculator');
  const [activeCategory, setActiveCategory] = useState('all');

  const categories = [
    { id: 'all', label: t.tools.categories.all },
    { id: 'utilities', label: t.tools.categories.utilities },
    { id: 'finance', label: t.tools.categories.finance },
    { id: 'media', label: t.tools.categories.media },
  ];

  const filteredTools = activeCategory === 'all'
    ? toolsData
    : toolsData.filter(tool => tool.category === activeCategory);

  const renderActiveTool = () => {
    switch (activeToolId) {
      case 'calculator':
        return <Calculator />;
      case 'age-calculator':
        return <AgeCalculator />;
      case 'qr-generator':
        return <QRCodeGenerator />;
      case 'image-compressor':
        return <ImageCompressor />;
      case 'text-to-speech':
        return <TextToSpeech />;
      case 'youtube-thumbnail':
        return <YouTubeThumbnailDownloader />;
      case 'password-generator':
        return <PasswordGenerator />;
      case 'invoice-maker':
        return <InvoiceMaker />;
      case 'resume-builder':
        return <ResumeBuilder />;
      case 'background-remover':
        return <BackgroundRemover />;
      default:
        return <Calculator />;
    }
  };

  const currentTool = toolsData.find(t => t.id === activeToolId) || toolsData[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs font-bold uppercase tracking-wider">
          <Wrench className="w-3.5 h-3.5" />
          <span>{isRtl ? '10 مکمل ڈیجیٹل ٹولز' : '10 Browser-Powered Tools'}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          {t.tools.title}
        </h1>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
          {t.tools.subtitle}
        </p>
      </div>

      {/* Category Pills Filter */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeCategory === cat.id
                ? 'bg-brand-gold-500 text-brand-navy-900 shadow-md shadow-brand-gold-500/20'
                : 'bg-white dark:bg-brand-navy-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-brand-navy-700 hover:border-brand-gold-500/40'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Tools Horizontal Selection Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {filteredTools.map((tool) => {
          const Icon = iconMap[tool.icon] || Wrench;
          const isSelected = activeToolId === tool.id;
          const name = tool.name[lang] || tool.name.en;

          return (
            <button
              key={tool.id}
              onClick={() => setActiveToolId(tool.id)}
              type="button"
              className={`p-3.5 rounded-2xl border text-left transition-all duration-200 flex flex-col justify-between gap-3 ${
                isSelected
                  ? 'bg-brand-gold-500/15 border-brand-gold-500 text-brand-navy-900 dark:text-white ring-2 ring-brand-gold-500/30 shadow-lg'
                  : 'bg-white dark:bg-brand-navy-800/80 border-slate-200 dark:border-brand-navy-700/80 text-slate-700 dark:text-slate-300 hover:border-brand-gold-500/40 hover:bg-slate-50 dark:hover:bg-brand-navy-700/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className={`p-2 rounded-xl ${
                  isSelected 
                    ? 'bg-brand-gold-500 text-brand-navy-900' 
                    : 'bg-slate-100 dark:bg-brand-navy-700 text-brand-gold-500'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                  tool.isDemoOnly
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                }`}>
                  {tool.isDemoOnly ? 'Demo' : 'Active'}
                </span>
              </div>

              <div>
                <span className="font-bold text-xs line-clamp-1 block">
                  {name}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Active Tool Stage */}
      <div className="pt-4">
        {renderActiveTool()}
      </div>

      {/* Privacy & Engine Transparency Note */}
      <div className="max-w-3xl mx-auto p-4 rounded-2xl bg-slate-100 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700/60 flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-brand-gold-500 flex-shrink-0" />
          <span>
            {isRtl
              ? 'تمام ٹولز خالص جاوا اسکرپٹ پر چلتے ہیں اور آپ کے کمپیوٹر پر محفوظ رہتے ہیں۔'
              : 'All 10 tools execute client-side using native browser APIs and canvas processing.'}
          </span>
        </div>
        <span className="font-semibold text-brand-gold-500 flex-shrink-0 font-mono">
          Step 1 Client Engine
        </span>
      </div>
    </div>
  );
}
