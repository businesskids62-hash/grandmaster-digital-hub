import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { QrCode, Download, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function QRCodeGenerator() {
  const { isRtl } = useLanguage();
  const [text, setText] = useState('https://grandmasterhub.digital');
  const [size, setSize] = useState(256);
  const [errorLevel, setErrorLevel] = useState('M');
  const [darkColor, setDarkColor] = useState('#060B18');
  const [lightColor, setLightColor] = useState('#FFFFFF');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  const generateQRCode = async () => {
    setError('');
    if (!text.trim()) {
      setError(isRtl ? 'براہ کرم کوئی متن یا یو آر ایل درج کریں۔' : 'Please enter text or a URL.');
      setQrDataUrl('');
      return;
    }

    try {
      const url = await QRCode.toDataURL(text, {
        width: size,
        margin: 2,
        errorCorrectionLevel: errorLevel,
        color: {
          dark: darkColor,
          light: lightColor
        }
      });
      setQrDataUrl(url);

      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, text, {
          width: size,
          margin: 2,
          errorCorrectionLevel: errorLevel,
          color: {
            dark: darkColor,
            light: lightColor
          }
        });
      }
    } catch (err) {
      setError(err?.message || 'Failed to render QR Code');
    }
  };

  useEffect(() => {
    generateQRCode();
  }, [text, size, errorLevel, darkColor, lightColor]);

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `qrcode-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <QrCode className="w-5 h-5 text-brand-gold-500" />
            <span>{isRtl ? 'اصلی کیو آر کوڈ جنریٹر' : 'Real Dynamic QR Code Generator'}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl ? 'سکین کرنے کے قابل معیاری کیو آر کوڈز ڈاؤن لوڈ کریں' : 'Scannable, high-density matrix barcodes for links, WiFi, or text'}
          </p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
          Standard Compliant
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
            {isRtl ? 'متن یا ویب سائٹ کا پتہ' : 'URL or Text Content'}
          </label>
          <div className="relative">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://yourwebsite.com or custom message"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold-500/40"
            />
            {text && (
              <button
                type="button"
                onClick={handleCopyLink}
                className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-brand-gold-500 flex items-center gap-1"
                title="Copy text"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Configuration Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              {isRtl ? 'ریزولوشن' : 'Resolution'}
            </label>
            <select
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
            >
              <option value={160}>160 x 160 px (Compact)</option>
              <option value={256}>256 x 256 px (Standard)</option>
              <option value={384}>384 x 384 px (HD)</option>
              <option value={512}>512 x 512 px (Ultra)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              {isRtl ? 'خرابی کی درستگی' : 'Error Correction'}
            </label>
            <select
              value={errorLevel}
              onChange={(e) => setErrorLevel(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
            >
              <option value="L">Low (7% recovery)</option>
              <option value="M">Medium (15% recovery)</option>
              <option value="Q">Quartile (25% recovery)</option>
              <option value="H">High (30% recovery)</option>
            </select>
          </div>

          <div className="col-span-2 sm:col-span-1 flex gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {isRtl ? 'رنگ' : 'Color'}
              </label>
              <input
                type="color"
                value={darkColor}
                onChange={(e) => setDarkColor(e.target.value)}
                className="w-full h-8 rounded-lg border border-slate-300 dark:border-brand-navy-700 cursor-pointer p-0.5 bg-white dark:bg-brand-navy-900"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {isRtl ? 'پس منظر' : 'Background'}
              </label>
              <input
                type="color"
                value={lightColor}
                onChange={(e) => setLightColor(e.target.value)}
                className="w-full h-8 rounded-lg border border-slate-300 dark:border-brand-navy-700 cursor-pointer p-0.5 bg-white dark:bg-brand-navy-900"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* QR Preview & Download */}
        <div className="pt-4 flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-50 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700/60">
          <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-200/80 mb-4 inline-block">
            <canvas ref={canvasRef} className="rounded-lg max-w-[200px] h-auto" />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!qrDataUrl}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md transition disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isRtl ? 'پی این جی ڈاؤن لوڈ کریں' : 'Download PNG'}</span>
            </button>
            <button
              type="button"
              onClick={generateQRCode}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-200/60 dark:bg-brand-navy-700 hover:bg-slate-200 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{isRtl ? 'تازہ کریں' : 'Regenerate'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
