import { useState, useRef } from 'react';
import { ImageDown, Upload, Download, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { formatBytes } from '../utils/formatters';

export default function ImageCompressor() {
  const { isRtl } = useLanguage();
  const [originalFile, setOriginalFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [compressedUrl, setCompressedUrl] = useState('');
  const [compressedBlob, setCompressedBlob] = useState(null);
  const [quality, setQuality] = useState(0.75);
  const [maxDimension, setMaxDimension] = useState(1600);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileSelect = (file) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(isRtl ? 'صرف تصویری فائلیں (JPG، PNG، WebP) اپ لوڈ کی جا سکتی ہیں۔' : 'Only image files (JPG, PNG, WebP) are supported.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError(isRtl ? 'تصویر کا سائز 25 ایم بی سے کم ہونا چاہیے۔' : 'Image exceeds maximum 25 MB limit.');
      return;
    }

    setOriginalFile(file);
    const objectUrl = URL.createObjectURL(file);
    setOriginalUrl(objectUrl);
    compressImage(file, quality, maxDimension);
  };

  const compressImage = (file, targetQuality, targetMaxDim) => {
    if (!file) return;
    setCompressing(true);
    setError('');

    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
    };

    img.onload = () => {
      try {
        let width = img.width;
        let height = img.height;

        if (width > targetMaxDim || height > targetMaxDim) {
          if (width > height) {
            height = Math.round((height * targetMaxDim) / width);
            width = targetMaxDim;
          } else {
            width = Math.round((width * targetMaxDim) / height);
            height = targetMaxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              setError('Failed to compress image in canvas.');
              setCompressing(false);
              return;
            }
            if (compressedUrl) {
              URL.revokeObjectURL(compressedUrl);
            }
            const blobUrl = URL.createObjectURL(blob);
            setCompressedBlob(blob);
            setCompressedUrl(blobUrl);
            setCompressing(false);
          },
          mimeType,
          targetQuality
        );
      } catch (err) {
        setError(err?.message || 'Error occurred during image compression.');
        setCompressing(false);
      }
    };

    img.onerror = () => {
      setError('Could not decode the selected image.');
      setCompressing(false);
    };

    reader.readAsDataURL(file);
  };

  const handleQualityChange = (newQ) => {
    setQuality(newQ);
    if (originalFile) {
      compressImage(originalFile, newQ, maxDimension);
    }
  };

  const handleDimensionChange = (newDim) => {
    setMaxDimension(newDim);
    if (originalFile) {
      compressImage(originalFile, quality, newDim);
    }
  };

  const handleDownload = () => {
    if (!compressedUrl || !originalFile) return;
    const a = document.createElement('a');
    a.href = compressedUrl;
    const ext = originalFile.type === 'image/png' ? '.png' : '.jpg';
    a.download = `compressed-${originalFile.name.replace(/\.[^/.]+$/, '')}${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const calculateSavings = () => {
    if (!originalFile || !compressedBlob) return 0;
    const diff = originalFile.size - compressedBlob.size;
    if (diff <= 0) return 0;
    return Math.round((diff / originalFile.size) * 100);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <ImageDown className="w-5 h-5 text-brand-gold-500" />
            <span>{isRtl ? 'مقامی امیج کمپریسر' : 'Client-Side Image Compressor'}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl ? 'آپ کی تصاویر آپ کے کمپیوٹر پر ہی کمپریس ہوتی ہیں، سرور پر نہیں جاتیں' : 'Compress JPG, PNG, and WebP locally without cloud upload for 100% privacy'}
          </p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
          Zero-Upload Local
        </span>
      </div>

      {/* Upload Zone */}
      {!originalFile ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
          }}
          className="p-10 border-2 border-dashed border-slate-300 dark:border-brand-navy-700 rounded-2xl hover:border-brand-gold-500/60 dark:hover:border-brand-gold-500/60 cursor-pointer text-center bg-slate-50 dark:bg-brand-navy-900/40 transition group"
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
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-brand-gold-500/10 text-brand-gold-500 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Upload className="w-6 h-6" />
          </div>
          <p className="font-semibold text-sm text-slate-800 dark:text-slate-200">
            {isRtl ? 'تصویر منتخب کرنے کے لیے یہاں کلک کریں یا ڈریگ کریں' : 'Click to select or drag and drop an image'}
          </p>
          <span className="text-xs text-slate-400 mt-1 block">
            JPG, PNG, WebP • Max 25 MB • 100% Private In-Browser
          </span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Controls */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-xs">
                {originalFile.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOriginalFile(null);
                  setOriginalUrl('');
                  setCompressedUrl('');
                  setCompressedBlob(null);
                }}
                className="text-xs text-brand-gold-500 hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isRtl ? 'دوسری فائل منتخب کریں' : 'Choose different image'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                  <span>{isRtl ? 'کوالٹی' : 'Compression Quality'}</span>
                  <span className="font-mono font-bold text-brand-gold-500">{Math.round(quality * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={quality}
                  onChange={(e) => handleQualityChange(parseFloat(e.target.value))}
                  className="w-full accent-brand-gold-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                  <span>{isRtl ? 'زیادہ سے زیادہ چوڑائی' : 'Max Dimension'}</span>
                  <span className="font-mono font-bold text-brand-gold-500">{maxDimension}px</span>
                </div>
                <select
                  value={maxDimension}
                  onChange={(e) => handleDimensionChange(Number(e.target.value))}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white"
                >
                  <option value={800}>800px (Web Thumbnail)</option>
                  <option value={1280}>1280px (Standard HD)</option>
                  <option value={1600}>1600px (Full HD)</option>
                  <option value={2400}>2400px (High Quality)</option>
                  <option value={4000}>4000px (Original Canvas)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Size Comparison Card */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700 text-center">
              <span className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                {isRtl ? 'اصل سائز' : 'Original Size'}
              </span>
              <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-200 mt-1 block">
                {formatBytes(originalFile.size)}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center">
              <span className="block text-[11px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                {isRtl ? 'کمپریس شدہ' : 'Compressed Size'}
              </span>
              <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                {compressedBlob ? formatBytes(compressedBlob.size) : 'Calculating...'}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-brand-gold-500/10 border border-brand-gold-500/30 text-center">
              <span className="block text-[11px] font-medium text-brand-gold-600 dark:text-brand-gold-400 uppercase tracking-wider">
                {isRtl ? 'بچت' : 'Space Saved'}
              </span>
              <span className="text-base font-bold font-mono text-brand-gold-600 dark:text-brand-gold-400 mt-1 block">
                {calculateSavings()}%
              </span>
            </div>
          </div>

          {/* Image Previews */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="text-xs font-semibold text-slate-500 block mb-1.5">{isRtl ? 'اصل تصویر' : 'Original Preview'}</span>
              <div className="aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-brand-navy-900 flex items-center justify-center border border-slate-200 dark:border-brand-navy-700">
                <img src={originalUrl} alt="Original" className="max-h-full max-w-full object-contain" />
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 block mb-1.5">{isRtl ? 'کمپریس شدہ پیش نظارہ' : 'Compressed Preview'}</span>
              <div className="aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-brand-navy-900 flex items-center justify-center border border-slate-200 dark:border-brand-navy-700">
                {compressedUrl ? (
                  <img src={compressedUrl} alt="Compressed" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-xs text-slate-400">Processing...</span>
                )}
              </div>
            </div>
          </div>

          {/* Download button */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!compressedUrl || compressing}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 to-amber-500 hover:from-brand-gold-400 hover:to-amber-400 text-brand-navy-900 shadow-md transition disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isRtl ? 'کمپریس شدہ فائل محفوظ کریں' : 'Download Compressed Image'}</span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
