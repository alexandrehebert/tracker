'use client';

import { Download, Share } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type InstallMode = 'hidden' | 'prompt' | 'ios-safari' | 'mac-safari';

function isRunningStandalone() {
  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

function detectInstallMode(): InstallMode {
  if (typeof window === 'undefined' || isRunningStandalone()) {
    return 'hidden';
  }

  const userAgent = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);
  const isMac = /Macintosh/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS|Edg|OPR|Firefox|FxiOS/i.test(userAgent);

  if (isSafari && isIos) {
    return 'ios-safari';
  }

  if (isSafari && isMac) {
    return 'mac-safari';
  }

  return 'hidden';
}

export function PwaInstallCallToAction() {
  const t = useTranslations('landing');
  const [installMode, setInstallMode] = useState<InstallMode>('hidden');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }

    setInstallMode(detectInstallMode());

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      setDeferredPrompt(promptEvent);
      setInstallMode('prompt');
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setInstallMode('hidden');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (process.env.NODE_ENV !== 'production' || installMode === 'hidden') {
    return null;
  }

  const handleInstall = async () => {
    if (!deferredPrompt || isPending) {
      return;
    }

    setIsPending(true);

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;

      if (choice.outcome === 'accepted') {
        setInstallMode('hidden');
      }
    } finally {
      setDeferredPrompt(null);
      setIsPending(false);
    }
  };

  if (installMode === 'prompt') {
    return (
      <button
        type="button"
        onClick={() => void handleInstall()}
        className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300/45 bg-sky-400/12 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:border-sky-200/70 hover:bg-sky-300/16 disabled:cursor-wait disabled:opacity-70"
        disabled={isPending}
      >
        <Download className="h-4 w-4" />
        {isPending ? t('install_cta_pending') : t('install_cta')}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 shadow-[0_18px_50px_rgba(2,6,23,0.3)] backdrop-blur-sm">
      <p className="flex items-center gap-2 font-semibold text-white">
        <Share className="h-4 w-4 text-amber-300" />
        {installMode === 'ios-safari' ? t('install_ios_title') : t('install_mac_title')}
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-300">
        {installMode === 'ios-safari' ? t('install_ios_hint') : t('install_mac_hint')}
      </p>
    </div>
  );
}