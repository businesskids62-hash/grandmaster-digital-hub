import { useState } from 'react';
import { Youtube, Download, ExternalLink, AlertCircle, Copy, Check, Search } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function YouTubeThumbnailDownloader() {
  const { isRtl } = useLanguage();
  const [urlInput, setUrlInput] = useState('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const [videoId, setVideoId] = useState('dQw4w9WgXcQ');
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  // Extract YouTube ID safely
  const extractVideoId = (input) => {
    if (!input) return null;
    const trimmed = input.trim();

    // Direct 11 character ID check
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }

    // RegEx patterns for YouTube URL variants
    const patterns = [
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
      /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  };

  const handleFetch = (e) => {
    e?.preventDefault();
    setError('');

    if (!urlInput.trim()) {
      setError(isRtl ? 'براہ کرم یوٹیوب ویڈیو کا لنک درج کریں۔' : 'Please enter a valid YouTube video URL or ID.');
      return;
    }

    const id = extractVideoId(urlInput);
    if (!id) {
      setError(
        isRtl
          ? 'غلط یوٹیوب لنک یا ویڈیو آئی ڈی۔ براہ کرم درست لنک درج کریں۔'
          : 'Invalid YouTube URL or Video ID format. Expected format: https://youtube.com/watch?v=... or 11-char ID.'
      );
      return;
    }

    setVideoId(id);
  };

  const thumbnailTiers = videoId ? [
    {
      label: 'Maximum Resolution (1080p / 720p)',
      labelUr: 'فل ایچ ڈی ریزولوشن (1080p)',
      key: 'maxres',
      url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      res: '1280 × 720 px'
    },
    {
      label: 'High Definition (HQ)',
      labelUr: 'ہائی ڈیفینیشن (HQ)',
      key: 'hq',
      url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      res: '480 × 360 px'
    },
    {
      label: 'Medium Quality (MQ)',
      labelUr: 'میڈیم کوالٹی (MQ)',
      key: 'mq',
      url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      res: '320 × 180 px'
    },
    {
      label: 'Standard Definition (SD)',
      labelUr: 'معیاری ڈیفینیشن (SD)',
      key: 'sd',
      url: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
      res: '640 × 480 px'
    }
  ] : [];

  const handleCopy = (key, text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  const handleDownload = async (imageUrl, filename) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback: direct window open
      window.open(imageUrl, '_blank');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-brand-navy-700/60 mb-6">
        <div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Youtube className="w-5 h-5 text-red-500" />
            <span>{isRtl ? 'یوٹیوب تھمب نیل ڈاؤنلوڈر' : 'YouTube Thumbnail Viewer & Grabber'}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl ? 'ویڈیو لنک درج کریں اور اصل ہائی ریزولوشن تھمب نیلز حاصل کریں' : 'Validated extraction of official public thumbnail resolutions'}
          </p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
          Public API CDN
        </span>
      </div>

      <form onSubmit={handleFetch} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
            {isRtl ? 'یوٹیوب لنک یا ویڈیو آئی ڈی' : 'YouTube Video URL or Video ID'}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="e.g. https://www.youtube.com/watch?v=... or youtu.be/..."
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-brand-navy-700 bg-white dark:bg-brand-navy-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold-500/40"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-md transition"
            >
              <Search className="w-4 h-4" />
              <span>{isRtl ? 'تلاش کریں' : 'Fetch'}</span>
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

      {/* Results grid */}
      {videoId && (
        <div className="mt-6 pt-6 border-t border-slate-200 dark:border-brand-navy-700/60 space-y-6">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {isRtl ? 'شناخت شدہ ویڈیو آئی ڈی:' : 'Verified Video ID:'}{' '}
              <strong className="text-slate-900 dark:text-white font-mono">{videoId}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {thumbnailTiers.map((tier) => (
              <div
                key={tier.key}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {isRtl ? tier.labelUr : tier.label}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{tier.res}</span>
                </div>

                <div className="aspect-video rounded-xl overflow-hidden bg-slate-200 dark:bg-brand-navy-800 border border-slate-200 dark:border-brand-navy-700 relative group">
                  <img
                    src={tier.url}
                    alt={tier.label}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      e.target.onerror = null;
                      // Fallback to hq if maxres is unavailable on low res videos
                      e.target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(tier.key, tier.url)}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
                  >
                    {copiedKey === tier.key ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-emerald-500">{isRtl ? 'کاپی ہو گیا' : 'Copied'}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>{isRtl ? 'لنک کاپی' : 'Copy URL'}</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-1.5">
                    <a
                      href={tier.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-brand-navy-700 transition"
                      title="Open in new tab"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDownload(tier.url, `thumbnail-${videoId}-${tier.key}.jpg`)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-gold-500/15 hover:bg-brand-gold-500/25 text-brand-gold-600 dark:text-brand-gold-400 font-semibold text-xs transition border border-brand-gold-500/30"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{isRtl ? 'ڈاؤن لوڈ' : 'Download'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
