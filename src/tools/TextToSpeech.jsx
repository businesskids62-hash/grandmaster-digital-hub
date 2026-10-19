import { useState, useEffect } from 'react';
import { Volume2, Play, Pause, Square, AlertCircle, RefreshCw } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function TextToSpeech() {
  const { isRtl } = useLanguage();
  const [text, setText] = useState(
    'Welcome to the Grandmaster Digital Hub. Learn, Build, and Earn with our next-generation digital ecosystem.'
  );
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [pitch, setPitch] = useState(1);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [status, setStatus] = useState('idle'); // idle, speaking, paused
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      setIsSupported(false);
      setError(
        isRtl
          ? 'آپ کا ویب براؤزر اسپیچ سنتھیسس کو سپورٹ نہیں کرتا۔'
          : 'Your browser does not support the Web Speech Synthesis API.'
      );
      return;
    }

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      if (available.length > 0 && !selectedVoice) {
        // Find default or English/Urdu voice
        const def = available.find(v => v.default) || available[0];
        setSelectedVoice(def.name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSpeak = () => {
    setError('');
    if (!isSupported) return;
    if (!text.trim()) {
      setError(isRtl ? 'براہ کرم بولنے کے لیے متن درج کریں۔' : 'Please enter text to synthesize.');
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedVoice) {
      const voiceObj = voices.find(v => v.name === selectedVoice);
      if (voiceObj) utterance.voice = voiceObj;
    }
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.volume = volume;

    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    utterance.onerror = (e) => {
      setStatus('idle');
      if (e.error !== 'interrupted') {
        setError(`Speech synthesis error: ${e.error}`);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  const handlePause = () => {
    if (status === 'speaking') {
      window.speechSynthesis.pause();
      setStatus('paused');
    }
  };

  const handleResume = () => {
    if (status === 'paused') {
      window.speechSynthesis.resume();
      setStatus('speaking');
    }
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setStatus('idle');
  };

  const setSampleText = (type) => {
    if (type === 'en') {
      setText('Welcome to the Grandmaster Digital Hub. Empowering learners and developers through world-class technology.');
    } else {
      setText('گرینڈ ماسٹر ڈیجیٹل ہب میں خوش آمدید۔ سیکھیں، بنائیں اور کمائیں۔');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-brand-gold-500" />
            <span>{isRtl ? 'براؤزر ٹیکسٹ ٹو اسپیچ' : 'Browser Text-to-Speech Synthesizer'}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl ? 'قدرتی آواز کے ساتھ متن کو تقریر میں تبدیل کریں' : 'Hardware-accelerated client-side neural & system speech synthesis'}
          </p>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${
          status === 'speaking' 
            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 animate-pulse'
            : status === 'paused'
            ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
            : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
        }`}>
          {status === 'speaking' ? '● Speaking' : status === 'paused' ? '❚❚ Paused' : 'Ready'}
        </span>
      </div>

      <div className="space-y-4">
        {/* Sample text buttons */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">{isRtl ? 'نمونہ متن:' : 'Sample text:'}</span>
          <button
            type="button"
            onClick={() => setSampleText('en')}
            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-brand-navy-700 hover:bg-slate-200 text-slate-700 dark:text-slate-300 transition"
          >
            English Sample
          </button>
          <button
            type="button"
            onClick={() => setSampleText('ur')}
            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-brand-navy-700 hover:bg-slate-200 text-slate-700 dark:text-slate-300 transition"
          >
            اردو نمونہ
          </button>
        </div>

        {/* Text Area */}
        <div>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text to synthesize into spoken audio..."
            className="w-full px-4 py-3 rounded-2xl border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold-500/40 resize-y"
          />
        </div>

        {/* Voice Selector */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
            {isRtl ? 'آواز کا انتخاب کریں' : 'Select Voice & Accent'}
          </label>
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
          >
            {voices.length === 0 ? (
              <option value="">System Default Voice</option>
            ) : (
              voices.map((v, i) => (
                <option key={i} value={v.name}>
                  {v.name} ({v.lang}) {v.default ? '— Default' : ''}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Sliders: Pitch, Rate, Volume */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div>
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
              <span>{isRtl ? 'رفتار' : 'Speed / Rate'}</span>
              <span className="font-mono font-bold text-brand-gold-500">{rate}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full accent-brand-gold-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
              <span>{isRtl ? 'پچ' : 'Pitch'}</span>
              <span className="font-mono font-bold text-brand-gold-500">{pitch}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full accent-brand-gold-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
              <span>{isRtl ? 'آواز کا حجم' : 'Volume'}</span>
              <span className="font-mono font-bold text-brand-gold-500">{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1.0"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full accent-brand-gold-500"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Control Buttons */}
        <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
          {status !== 'speaking' ? (
            <button
              type="button"
              onClick={status === 'paused' ? handleResume : handleSpeak}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md transition"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{status === 'paused' ? (isRtl ? 'دوبارہ شروع کریں' : 'Resume') : (isRtl ? 'آواز چلائیں' : 'Speak Text')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePause}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-amber-500 hover:bg-amber-400 text-brand-navy-900 shadow-md transition"
            >
              <Pause className="w-4 h-4 fill-current" />
              <span>{isRtl ? 'روکیں' : 'Pause'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleStop}
            disabled={status === 'idle'}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-200/60 dark:bg-brand-navy-700 hover:bg-slate-200 transition disabled:opacity-40"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>{isRtl ? 'بند کریں' : 'Stop'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
