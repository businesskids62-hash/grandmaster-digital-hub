import { useState, useRef } from 'react';
import { Scissors, Upload, Download, AlertTriangle, Sparkles, RefreshCw, Layers } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function BackgroundRemover() {
  const { isRtl } = useLanguage();
  const [imageFile, setImageFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [processedUrl, setProcessedUrl] = useState('');
  const [tolerance, setTolerance] = useState(30);
  const [targetColor, setTargetColor] = useState('#FFFFFF'); // White background default
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  const handleFileSelect = (file) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(isRtl ? 'صرف تصویری فائلیں اپ لوڈ کی جا سکتی ہیں۔' : 'Please upload a valid image file (PNG, JPG, WebP).');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError(isRtl ? 'تصویر کا سائز 15 ایم بی سے کم ہونا چاہیے۔' : 'File size exceeds maximum 15MB limit.');
      return;
    }

    setImageFile(file);
    const objUrl = URL.createObjectURL(file);
    setOriginalUrl(objUrl);
    applyThresholdRemoval(objUrl, targetColor, tolerance);
  };

  // Convert hex color to rgb
  const hexToRgb = (hex) => {
    const bigint = parseInt(hex.replace('#', ''), 16);
    return {
      r: (bigint >> 16) & 255,
      g: (bigint >> 8) & 255,
      b: bigint & 255
    };
  };

  // Real client-side chroma/luminance color-keying algorithm for high contrast demo
  const applyThresholdRemoval = (url, keyColorHex, tol) => {
    setIsProcessing(true);
    const img = new Image();
    img.src = url;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const keyRgb = hexToRgb(keyColorHex);
      const tolDist = (tol / 100) * 441; // max 3D distance sqrt(255^2 * 3) ~ 441.6

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Euclidean color distance
        const dist = Math.sqrt(
          Math.pow(r - keyRgb.r, 2) +
          Math.pow(g - keyRgb.g, 2) +
          Math.pow(b - keyRgb.b, 2)
        );

        if (dist < tolDist) {
          // Feather alpha based on edge
          const alphaFactor = Math.max(0, dist / tolDist);
          data[i + 3] = Math.round(255 * Math.pow(alphaFactor, 2));
        }
      }

      ctx.putImageData(imgData, 0, 0);
      const outUrl = canvas.toDataURL('image/png');
      setProcessedUrl(outUrl);
      setIsProcessing(false);
    };

    img.onerror = () => {
      setError('Could not process image on canvas.');
      setIsProcessing(false);
    };
  };

  const handleDownload = () => {
    if (!processedUrl) return;
    const a = document.createElement('a');
    a.href = processedUrl;
    a.download = `removed-bg-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Scissors className="w-5 h-5 text-amber-500" />
            <span>{isRtl ? 'اے آئی بیک گراؤنڈ ریموور انٹرفیس' : 'AI Background Remover Interface'}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl ? 'ڈیمو انٹرفیس مع لوکل کروما کلر کیئنگ' : 'Interactive prototype interface with client-side chroma keying'}
          </p>
        </div>
        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20 uppercase tracking-wider">
          Demo Prototype
        </span>
      </div>

      {/* Mandatory Demo Disclosure Banner */}
      <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-900 dark:text-amber-200">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <strong className="block font-semibold mb-0.5">
            {isRtl ? 'ڈیمو نوٹس: مکمل اے آئی ماڈل اگلے مرحلے میں منسلک ہوگا' : 'DEMO NOTICE: Full Deep-Learning AI Model Reserved for Future Steps'}
          </strong>
          {isRtl
            ? 'یہ انٹرفیس ایک ڈیمو پروٹو ٹائپ ہے۔ اس وقت یہ براؤزر کینوس پر سالڈ بیک گراؤنڈ کلر الگ کرنے کا مظاہرہ کرتا ہے۔ کلاؤڈ یا نیورل نیٹ ورک بیک گراؤنڈ کٹ آؤٹ ماڈل بعد کے مراحل میں گرینڈ ماسٹر ماڈیولز سے منسلک کیا جائے گا۔'
            : 'This is an architectural demonstration interface. It features client-side solid-color chroma keying on canvas. Full deep-learning segmenters (U-2-Net / BiRefNet) will connect during future Grandmaster AI ecosystem stages.'}
        </div>
      </div>

      {!imageFile ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
          }}
          className="p-10 border-2 border-dashed border-slate-300 dark:border-brand-navy-700 rounded-2xl hover:border-brand-gold-500/60 cursor-pointer text-center bg-slate-50 dark:bg-brand-navy-900/40 transition group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
            }}
          />
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Upload className="w-6 h-6" />
          </div>
          <p className="font-semibold text-sm text-slate-800 dark:text-slate-200">
            {isRtl ? 'ڈیمو ٹیسٹ کے لیے تصویر اپ لوڈ کریں' : 'Upload image to test demo removal'}
          </p>
          <span className="text-xs text-slate-400 mt-1 block">
            Solid or white backgrounds yield best client-side results
          </span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Controls */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {isRtl ? 'ڈیمو کروما ایڈجسٹمنٹ' : 'Demo Chroma & Threshold Settings'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  setOriginalUrl('');
                  setProcessedUrl('');
                }}
                className="text-xs text-brand-gold-500 hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isRtl ? 'دوسری تصویر منتخب کریں' : 'Choose another image'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="text-xs text-slate-600 dark:text-slate-300 block mb-1">
                  {isRtl ? 'ہٹانے کے لیے رنگ منتخب کریں' : 'Color to Remove (Key Color)'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={targetColor}
                    onChange={(e) => {
                      setTargetColor(e.target.value);
                      if (originalUrl) applyThresholdRemoval(originalUrl, e.target.value, tolerance);
                    }}
                    className="w-10 h-8 rounded-lg cursor-pointer border border-slate-300 dark:border-brand-navy-700 p-0.5 bg-white dark:bg-brand-navy-900"
                  />
                  <span className="text-xs font-mono text-slate-500">{targetColor.toUpperCase()}</span>
                  <div className="flex gap-1 ml-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setTargetColor('#FFFFFF');
                        if (originalUrl) applyThresholdRemoval(originalUrl, '#FFFFFF', tolerance);
                      }}
                      className="text-[10px] px-2 py-1 rounded bg-slate-200 dark:bg-brand-navy-700 text-slate-700 dark:text-slate-300"
                    >
                      White
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetColor('#00FF00');
                        if (originalUrl) applyThresholdRemoval(originalUrl, '#00FF00', tolerance);
                      }}
                      className="text-[10px] px-2 py-1 rounded bg-slate-200 dark:bg-brand-navy-700 text-slate-700 dark:text-slate-300"
                    >
                      Green
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetColor('#000000');
                        if (originalUrl) applyThresholdRemoval(originalUrl, '#000000', tolerance);
                      }}
                      className="text-[10px] px-2 py-1 rounded bg-slate-200 dark:bg-brand-navy-700 text-slate-700 dark:text-slate-300"
                    >
                      Black
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                  <span>{isRtl ? 'برداشت / ٹالرینس' : 'Tolerance Radius'}</span>
                  <span className="font-mono font-bold text-amber-500">{tolerance}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="80"
                  value={tolerance}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setTolerance(val);
                    if (originalUrl) applyThresholdRemoval(originalUrl, targetColor, val);
                  }}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Visual Previews */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="text-xs font-semibold text-slate-500 block mb-1.5">{isRtl ? 'اصل تصویر' : 'Original Image'}</span>
              <div className="aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-brand-navy-900 flex items-center justify-center border border-slate-200 dark:border-brand-navy-700">
                <img src={originalUrl} alt="Original" className="max-h-full max-w-full object-contain" />
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-500 block mb-1.5">
                {isRtl ? 'شفاف پیش نظارہ (ڈیمو کٹ)' : 'Transparent Cutout Preview (Demo)'}
              </span>
              <div
                className="aspect-video rounded-xl overflow-hidden flex items-center justify-center border border-slate-200 dark:border-brand-navy-700"
                style={{
                  backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px), radial-gradient(#94a3b8 1px, #f1f5f9 1px)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 8px 8px'
                }}
              >
                {processedUrl ? (
                  <img src={processedUrl} alt="Processed" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-xs text-slate-400">Processing...</span>
                )}
              </div>
            </div>
          </div>

          {/* Action */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!processedUrl || isProcessing}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-brand-navy-900 shadow-md transition disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isRtl ? 'پی این جی کٹ آؤٹ محفوظ کریں' : 'Download Cutout PNG'}</span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
