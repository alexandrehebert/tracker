'use client';

import { useEffect, useState } from 'react';

export function useIsMobile(): { isMobile: boolean; isResolved: boolean } {
  const [state, setState] = useState({ isMobile: false, isResolved: false });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const updateIsMobile = () => {
      setState({ isMobile: mediaQuery.matches, isResolved: true });
    };

    updateIsMobile();
    mediaQuery.addEventListener('change', updateIsMobile);

    return () => {
      mediaQuery.removeEventListener('change', updateIsMobile);
    };
  }, []);

  return state;
}
