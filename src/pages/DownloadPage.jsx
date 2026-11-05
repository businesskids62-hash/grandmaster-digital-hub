import React, { useState, useEffect } from "react";
import {
  Download,
  Smartphone,
  Share,
  PlusSquare,
  CheckCircle,
  QrCode,
  ShieldCheck,
  Zap,
  Globe,
  ArrowRight,
} from "lucide-react";
import QRCode from "qrcode";

export default function DownloadPage() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    // Detect iOS
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(ua);
    setIsIos(isAppleDevice);

    // Detect if already running standalone PWA
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    ) {
      setIsInstalled(true);
    }

    // Android / Desktop Chrome PWA beforeinstallprompt handler
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);

    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    // Generate dynamic QR Code for the current hub URL
    const currentUrl = typeof window !== "undefined" ? window.location.origin : "https://grandmaster-digital-hub.vercel.app";
    QRCode.toDataURL(currentUrl, { width: 220, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } })
      .then((url) => setQrDataUrl(url))
      .catch(() => {});

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      alert("PWA Install prompt abhi available nahi hai. Agar aap browser me hain to menu [⋮] dabakar 'Install app' ya 'Add to Home screen' karein.");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Hero Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase tracking-wider">
          <Smartphone className="w-4 h-4" />
          <span>Progressive Web App (PWA) · Ultra Fast</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
          Install <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-500">Grandmaster Hub</span> on Your Phone
        </h1>
        <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
          Zero PlayStore / AppStore friction. Instant offline load, home screen icon, and full-screen command center experience on Android and iPhone.
        </p>
      </div>

      {/* iPhone Safari Banner - Only visible on iPhone/iPad */}
      {isIos && (
        <div className="p-6 rounded-3xl bg-gradient-to-r from-blue-900/60 to-indigo-900/60 border border-blue-500/40 shadow-xl space-y-3">
          <div className="flex items-center gap-2 text-blue-300 text-sm font-bold">
            <Share className="w-5 h-5 text-blue-400" />
            <span>iPhone Safari Users Instructions</span>
          </div>
          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 text-xs sm:text-sm text-slate-200 font-medium space-y-2">
            <p>
              Safari browser me neeche Share <span className="inline-block px-1.5 py-0.5 rounded bg-white/20 font-mono">[ ⬆️ ]</span> dabayein:
            </p>
            <p className="flex items-center gap-2 text-amber-300 font-bold">
              <span>Share [⬆️]</span>
              <ArrowRight className="w-4 h-4" />
              <span>Add to Home Screen</span>
              <ArrowRight className="w-4 h-4" />
              <span>Add Dabao</span>
            </p>
          </div>
        </div>
      )}

      {/* 2 Bade Buttons (Big Action Buttons) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Button 1: Android Chrome / Desktop PWA Direct Install */}
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-white/10 shadow-xl flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Download className="w-4 h-4" />
              <span>Android &amp; Desktop</span>
            </div>
            <h3 className="text-xl font-bold text-white">Direct PWA Install</h3>
            <p className="text-xs text-slate-400 mt-1">
              Click below to trigger the native installation popup directly to your device.
            </p>
          </div>

          <button
            onClick={handleInstallClick}
            disabled={isInstalled}
            className="w-full py-4 rounded-2xl font-extrabold text-sm uppercase tracking-wider bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 shadow-lg shadow-amber-500/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2.5 disabled:opacity-50"
          >
            {isInstalled ? (
              <>
                <CheckCircle className="w-5 h-5 text-slate-950" />
                <span>Installed on Device</span>
              </>
            ) : (
              <>
                <Download className="w-5 h-5 text-slate-950" />
                <span>Install Hub Now</span>
              </>
            )}
          </button>
        </div>

        {/* Button 2: Web Live Experience (Standalone / Browser) */}
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-white/10 shadow-xl flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Globe className="w-4 h-4" />
              <span>Instant Web Hub</span>
            </div>
            <h3 className="text-xl font-bold text-white">Open Web Version</h3>
            <p className="text-xs text-slate-400 mt-1">
              Launch directly inside your browser window without downloading any native application.
            </p>
          </div>

          <a
            href="/"
            className="w-full py-4 rounded-2xl font-extrabold text-sm uppercase tracking-wider bg-white/10 hover:bg-white/15 text-white border border-white/15 transition-all text-center flex items-center justify-center gap-2.5"
          >
            <Zap className="w-5 h-5 text-amber-400" />
            <span>Launch Web Hub</span>
          </a>
        </div>
      </div>

      {/* 3 Step Guide + QR Code Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center p-8 rounded-3xl bg-slate-900/90 border border-white/10 shadow-2xl">
        {/* 3 Step Guide */}
        <div className="lg:col-span-7 space-y-6">
          <div>
            <h3 className="text-xl sm:text-2xl font-extrabold text-white">
              3-Step Fast Setup Guide
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Follow these simple steps to put the Grandmaster Command Center on any phone.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
              <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 font-extrabold text-sm flex items-center justify-center flex-shrink-0">
                1
              </span>
              <div>
                <h4 className="font-bold text-sm text-white">Scan QR Code or Open Link</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Open the hub website in Google Chrome (Android) or Safari (iPhone).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
              <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 font-extrabold text-sm flex items-center justify-center flex-shrink-0">
                2
              </span>
              <div>
                <h4 className="font-bold text-sm text-white">Tap "Install" or "Add to Home Screen"</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Click the install button or Safari's Share &rarr; Add to Home Screen button.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
              <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 font-extrabold text-sm flex items-center justify-center flex-shrink-0">
                3
              </span>
              <div>
                <h4 className="font-bold text-sm text-white">Launch App with 1-Tap</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Open from your phone home screen with full-screen view and instant local cache.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* QR Code */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center text-center p-6 rounded-3xl bg-slate-950/70 border border-white/10 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <QrCode className="w-4 h-4 text-amber-400" />
            <span>Mobile QR Code</span>
          </div>

          <div className="p-3 bg-white rounded-2xl shadow-2xl">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Grandmaster Hub QR Code" className="w-44 h-44 object-contain rounded-lg" />
            ) : (
              <div className="w-44 h-44 bg-slate-200 animate-pulse rounded-lg" />
            )}
          </div>

          <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
            Scan with your mobile camera to instantly open and install Grandmaster Digital Hub.
          </p>
        </div>
      </div>
    </div>
  );
}
