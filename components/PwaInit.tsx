'use client';

import { useEffect } from 'react';

export function PwaInit() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          await Promise.all(
            registrations
              .filter((registration) => registration.scope.startsWith(window.location.origin))
              .map((registration) => registration.unregister())
          );

          if ('caches' in window) {
            const cacheKeys = await window.caches.keys();
            await Promise.all(
              cacheKeys
                .filter((key) => key.startsWith('tracker-'))
                .map((key) => window.caches.delete(key))
            );
          }
        });

      return;
    }

    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      void registration.update();
    });
  }, []);

  return null;
}