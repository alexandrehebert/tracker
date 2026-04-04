'use client';

import { ReactNode } from 'react';
import { useScrollIntoView } from '~/lib/hooks/useScrollIntoView';

interface AnimatedSectionProps {
  children: ReactNode;
  animation?: 'fade-in-up' | 'fade-in-left' | 'fade-in-right' | 'scale-in' | 'fade-in-down';
  delay?: number;
  className?: string;
}

/**
 * Animated section component that fades in on scroll
 */
export function AnimatedSection({
  children,
  animation = 'fade-in-up',
  delay = 0,
  className = '',
}: AnimatedSectionProps) {
  const ref = useScrollIntoView(`animate-${animation}`);

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={`opacity-0 ${className}`}
      style={{ animationDelay: `${delay}ms` } as any}
    >
      {children}
    </div>
  );
}
