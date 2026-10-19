import { useState } from 'react';
import { Delete, RotateCcw, Equal } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function Calculator() {
  const { t, isRtl } = useLanguage();
  const [display, setDisplay] = useState('0');
  const [equation, setEquation] = useState('');
  const [history, setHistory] = useState([]);
  const [justCalculated, setJustCalculated] = useState(false);

  const handleDigit = (digit) => {
    if (justCalculated) {
      setDisplay(digit);
      setEquation(digit);
      setJustCalculated(false);
      return;
    }
    if (display === '0' && digit !== '.') {
      setDisplay(digit);
      setEquation(digit);
    } else {
      if (digit === '.' && display.includes('.')) return;
      setDisplay(prev => prev + digit);
      setEquation(prev => prev + digit);
    }
  };

  const handleOperator = (op) => {
    setJustCalculated(false);
    if (!equation && display === '0') {
      setEquation('0' + op);
      setDisplay('0');
      return;
    }
    const lastChar = equation.slice(-1);
    if (['+', '-', '*', '/'].includes(lastChar)) {
      setEquation(equation.slice(0, -1) + op);
    } else {
      setEquation(equation + op);
      setDisplay('0');
    }
  };

  const calculate = () => {
    if (!equation) return;
    try {
      // Safe sanitized evaluation for basic arithmetic
      const sanitized = equation.replace(/[^0-9+\-*/.]/g, '');
      if (!sanitized) return;
      // Evaluate using Function with strict bounds
      const result = Function(`'use strict'; return (${sanitized})`)();
      
      if (!isFinite(result) || isNaN(result)) {
        setDisplay('Error (Div by 0)');
        setEquation('');
        return;
      }
      
      const formatted = parseFloat(result.toFixed(8)).toString();
      setHistory(prev => [`${sanitized} = ${formatted}`, ...prev.slice(0, 4)]);
      setDisplay(formatted);
      setEquation(formatted);
      setJustCalculated(true);
    } catch {
      setDisplay('Syntax Error');
      setEquation('');
    }
  };

  const clearAll = () => {
    setDisplay('0');
    setEquation('');
    setJustCalculated(false);
  };

  const handleBackspace = () => {
    if (display.length > 1) {
      const next = display.slice(0, -1);
      setDisplay(next);
      setEquation(equation.slice(0, -1));
    } else {
      setDisplay('0');
      setEquation('');
    }
  };

  const toggleSign = () => {
    if (display === '0') return;
    const num = parseFloat(display);
    const toggled = (-num).toString();
    setDisplay(toggled);
    setEquation(toggled);
  };

  const handlePercent = () => {
    const num = parseFloat(display);
    if (isNaN(num)) return;
    const pct = (num / 100).toString();
    setDisplay(pct);
    setEquation(pct);
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-4">
        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <span>{isRtl ? 'درست حسابی کیلکولیٹر' : 'Precision Calculator'}</span>
        </h3>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
          Client-Side Active
        </span>
      </div>

      {/* Screen */}
      <div className="p-4 rounded-2xl bg-slate-100 dark:bg-brand-navy-900/90 border border-slate-200 dark:border-brand-navy-700 mb-4 text-right">
        <div className="text-xs text-slate-400 min-h-[1.25rem] font-mono overflow-x-auto truncate">
          {equation || '0'}
        </div>
        <div className="text-3xl font-bold font-mono text-slate-900 dark:text-brand-gold-400 truncate">
          {display}
        </div>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-2.5">
        <button
          onClick={clearAll}
          className="p-3.5 rounded-xl font-bold text-sm bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 transition"
        >
          AC
        </button>
        <button
          onClick={handleBackspace}
          className="p-3.5 rounded-xl font-bold text-sm bg-slate-200/60 dark:bg-brand-navy-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-brand-navy-600 transition flex items-center justify-center"
        >
          <Delete className="w-4 h-4" />
        </button>
        <button
          onClick={handlePercent}
          className="p-3.5 rounded-xl font-bold text-sm bg-slate-200/60 dark:bg-brand-navy-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-brand-navy-600 transition"
        >
          %
        </button>
        <button
          onClick={() => handleOperator('/')}
          className="p-3.5 rounded-xl font-bold text-lg bg-brand-gold-500/20 hover:bg-brand-gold-500/30 text-brand-gold-600 dark:text-brand-gold-400 transition"
        >
          ÷
        </button>

        {['7', '8', '9'].map(d => (
          <button
            key={d}
            onClick={() => handleDigit(d)}
            className="p-3.5 rounded-xl font-semibold text-lg bg-slate-100 dark:bg-brand-navy-700/60 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => handleOperator('*')}
          className="p-3.5 rounded-xl font-bold text-lg bg-brand-gold-500/20 hover:bg-brand-gold-500/30 text-brand-gold-600 dark:text-brand-gold-400 transition"
        >
          ×
        </button>

        {['4', '5', '6'].map(d => (
          <button
            key={d}
            onClick={() => handleDigit(d)}
            className="p-3.5 rounded-xl font-semibold text-lg bg-slate-100 dark:bg-brand-navy-700/60 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => handleOperator('-')}
          className="p-3.5 rounded-xl font-bold text-lg bg-brand-gold-500/20 hover:bg-brand-gold-500/30 text-brand-gold-600 dark:text-brand-gold-400 transition"
        >
          −
        </button>

        {['1', '2', '3'].map(d => (
          <button
            key={d}
            onClick={() => handleDigit(d)}
            className="p-3.5 rounded-xl font-semibold text-lg bg-slate-100 dark:bg-brand-navy-700/60 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => handleOperator('+')}
          className="p-3.5 rounded-xl font-bold text-lg bg-brand-gold-500/20 hover:bg-brand-gold-500/30 text-brand-gold-600 dark:text-brand-gold-400 transition"
        >
          +
        </button>

        <button
          onClick={toggleSign}
          className="p-3.5 rounded-xl font-semibold text-sm bg-slate-100 dark:bg-brand-navy-700/60 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
        >
          ±
        </button>
        <button
          onClick={() => handleDigit('0')}
          className="p-3.5 rounded-xl font-semibold text-lg bg-slate-100 dark:bg-brand-navy-700/60 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
        >
          0
        </button>
        <button
          onClick={() => handleDigit('.')}
          className="p-3.5 rounded-xl font-bold text-lg bg-slate-100 dark:bg-brand-navy-700/60 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
        >
          .
        </button>
        <button
          onClick={calculate}
          className="p-3.5 rounded-xl font-bold text-lg bg-gradient-to-r from-brand-gold-500 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md shadow-brand-gold-500/20 transition flex items-center justify-center"
        >
          <Equal className="w-5 h-5" />
        </button>
      </div>

      {history.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-brand-navy-700/60">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center justify-between">
            <span>{isRtl ? 'حالیہ حساب کتاب' : 'Calculation History'}</span>
            <button
              onClick={() => setHistory([])}
              className="text-slate-400 hover:text-red-500 transition text-[10px]"
            >
              {isRtl ? 'صاف کریں' : 'Clear'}
            </button>
          </div>
          <div className="space-y-1">
            {history.map((item, idx) => (
              <div key={idx} className="text-xs font-mono text-slate-600 dark:text-slate-400 text-right truncate">
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
