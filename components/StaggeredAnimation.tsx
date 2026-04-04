'use client';

import { ReactNode, ReactElement, Children, isValidElement, cloneElement } from 'react';
import { useScrollIntoViewStaggered } from '~/lib/hooks/useScrollIntoView';

interface StaggeredAnimationProps {
  children: ReactNode;
  animation?: 'fade-in-up' | 'fade-in-left' | 'fade-in-right' | 'scale-in' | 'fade-in-down';
  staggerDelay?: number;
  className?: string;
}

/**
 * Helper function to apply opacity-0 to children during render (prevents flash)
 */
function applyInitialOpacity(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (isValidElement(child)) {
      const typedChild = child as ReactElement<{ className?: string }>;
      const currentClassName = typedChild.props.className || '';
      const hasOpacity = currentClassName.includes('opacity');
      if (!hasOpacity) {
        const newClassName = `${currentClassName} opacity-0`.trim();
        return cloneElement(typedChild, { className: newClassName });
      }
    }
    return child;
  });
}

/**
 * Staggered animation component that animates children one after another on scroll
 */
export function StaggeredAnimation({
  children,
  animation = 'fade-in-up',
  staggerDelay = 80,
  className = '',
}: StaggeredAnimationProps) {
  const ref = useScrollIntoViewStaggered(`animate-${animation}`, {
    staggerDelay,
  });

  return (
    <div ref={ref as React.Ref<HTMLDivElement>} className={className}>
      {applyInitialOpacity(children)}
    </div>
  );
}
