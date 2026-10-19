import { useState, useEffect } from 'react';
import { KeyRound, Copy, Check, RefreshCw, ShieldCheck, ShieldAlert, Sparkles } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function PasswordGenerator() {
  const { isRtl } = useLanguage();
  const [password, setPassword] = useState('');
  const [length, setLength] = useState(16);
  const [includeUpper, setIncludeUpper] = useState(true);
  const [includeLower, setIncludeLower] = useState(true);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [copied, setCopied] = useState(false);

  const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
  const numberChars = '0123456789';
  const symbolChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  const generatePassword = () => {
    let charPool = '';
    const guaranteed = [];

    if (includeUpper) {
      charPool += upperChars;
      guaranteed.push(getRandomChar(upperChars));
    }
    if (includeLower) {
      charPool += lowerChars;
      guaranteed.push(getRandomChar(lowerChars));
    }
    if (includeNumbers) {
      charPool += numberChars;
      guaranteed.push(getRandomChar(numberChars));
    }
    if (includeSymbols) {
      charPool += symbolChars;
      guaranteed.push(getRandomChar(symbolChars));
    }

    if (charPool === '') {
      setPassword('');
      return;
    }

    const remainingLength = Math.max(0, length - guaranteed.length);
    const randomArray = new Uint32Array(remainingLength);
    window.crypto.getRandomValues(randomArray);

    const generatedChars = [...guaranteed];
    for (let i = 0; i < remainingLength; i++) {
      generatedChars.push(charPool[randomArray[i] % charPool.length]);
    }

    // Cryptographic shuffle (Fisher-Yates)
    const shuffleArray = new Uint32Array(generatedChars.length);
    window.crypto.getRandomValues(shuffleArray);
    for (let i = generatedChars.length - 1; i > 0; i--) {
      const j = shuffleArray[i] % (i + 1);
      [generatedChars[i], generatedChars[j]] = [generatedChars[j], generatedChars[i]];
    }

    setPassword(generatedChars.join(''));
  };

  const getRandomChar = (str) => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return str[array[0] % str.length];
  };

  useEffect(() => {
    generatePassword();
  }, [length, includeUpper, includeLower, includeNumbers, includeSymbols]);

  const handleCopy = () => {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Calculate strength score
  const getStrength = () => {
    if (!password) return { label: 'Empty', score: 0, color: 'bg-slate-300' };
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
    if (includeUpper && includeLower) score += 1;
    if (includeNumbers) score += 1;
    if (includeSymbols) score += 1;

    if (score <= 2) return { label: isRtl ? 'کمزور' : 'Weak', score: 20, color: 'bg-red-500' };
    if (score <= 3) return { label: isRtl ? 'مناسب' : 'Fair', score: 45, color: 'bg-amber-500' };
    if (score <= 4) return { label: isRtl ? 'مضبوط' : 'Good', score: 70, color: 'bg-blue-500' };
    if (score <= 5) return { label: isRtl ? 'بہت مضبوط' : 'Strong', score: 90, color: 'bg-emerald-500' };
    return { label: isRtl ? 'ناقابل تسخیر' : 'Uncrackable (Military Grade)', score: 100, color: 'bg-gradient-to-r from-emerald-500 to-brand-gold-500' };
  };

  const strength = getStrength();

  return (
    <div className="max-w-xl mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-brand-gold-500" />
            <span>{isRtl ? 'کرپٹو گرافک پاس ورڈ جنریٹر' : 'Cryptographic Password Generator'}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl ? 'ونڈو کرپٹو ای پی آئی کی مدد سے مکمل محفوظ پاس ورڈ بنائیں' : 'True high-entropy random generation via window.crypto.getRandomValues'}
          </p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Hardware Entropy</span>
        </span>
      </div>

      <div className="space-y-5">
        {/* Output Display */}
        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-brand-navy-900/90 border border-slate-200 dark:border-brand-navy-700 flex items-center justify-between gap-3">
          <div className="font-mono text-lg font-bold text-slate-900 dark:text-brand-gold-400 break-all select-all">
            {password || (
              <span className="text-xs text-slate-400 italic font-sans">
                {isRtl ? 'کم از کم ایک آپشن منتخب کریں' : 'Select at least one character type'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={generatePassword}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
              title="Generate new password"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!password}
              className="p-2 rounded-xl bg-brand-gold-500/15 hover:bg-brand-gold-500/25 text-brand-gold-600 dark:text-brand-gold-400 font-medium text-xs transition border border-brand-gold-500/30 flex items-center gap-1 disabled:opacity-50"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-500 font-bold">{isRtl ? 'کاپی شدہ' : 'Copied'}</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>{isRtl ? 'کاپی' : 'Copy'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Strength Meter */}
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-slate-500">{isRtl ? 'سیکیورٹی طاقت:' : 'Password Strength:'}</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{strength.label}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-brand-navy-700 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${strength.color}`}
              style={{ width: `${strength.score}%` }}
            />
          </div>
        </div>

        {/* Length Slider */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700">
          <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            <span>{isRtl ? 'پاس ورڈ کی لمبائی' : 'Character Length'}</span>
            <span className="font-mono font-bold text-brand-gold-500 text-sm">{length}</span>
          </div>
          <input
            type="range"
            min="6"
            max="64"
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-full accent-brand-gold-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>6 (Min)</span>
            <span>16 (Recommended)</span>
            <span>32 (High)</span>
            <span>64 (Ultra)</span>
          </div>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900/40 cursor-pointer hover:border-brand-gold-500/40 transition">
            <input
              type="checkbox"
              checked={includeUpper}
              onChange={(e) => setIncludeUpper(e.target.checked)}
              className="rounded accent-brand-gold-500 w-4 h-4 cursor-pointer"
            />
            <span className="text-slate-800 dark:text-slate-200 font-medium">
              Uppercase (A-Z)
            </span>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900/40 cursor-pointer hover:border-brand-gold-500/40 transition">
            <input
              type="checkbox"
              checked={includeLower}
              onChange={(e) => setIncludeLower(e.target.checked)}
              className="rounded accent-brand-gold-500 w-4 h-4 cursor-pointer"
            />
            <span className="text-slate-800 dark:text-slate-200 font-medium">
              Lowercase (a-z)
            </span>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900/40 cursor-pointer hover:border-brand-gold-500/40 transition">
            <input
              type="checkbox"
              checked={includeNumbers}
              onChange={(e) => setIncludeNumbers(e.target.checked)}
              className="rounded accent-brand-gold-500 w-4 h-4 cursor-pointer"
            />
            <span className="text-slate-800 dark:text-slate-200 font-medium">
              Numbers (0-9)
            </span>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900/40 cursor-pointer hover:border-brand-gold-500/40 transition">
            <input
              type="checkbox"
              checked={includeSymbols}
              onChange={(e) => setIncludeSymbols(e.target.checked)}
              className="rounded accent-brand-gold-500 w-4 h-4 cursor-pointer"
            />
            <span className="text-slate-800 dark:text-slate-200 font-medium">
              Symbols (!@#$%)
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
