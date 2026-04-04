'use client';

import { useEffect, useRef } from 'react';

interface UseScrollIntoViewOptions {
  threshold?: number | number[];
  rootMargin?: string;
  onceOnly?: boolean;
}

/**
 * Hook to trigger animations when element scrolls into view
 * Adds the animation class to the element and optionally its children
 */
export function useScrollIntoView(
  animationClass: string,
  options: UseScrollIntoViewOptions = {},
) {
  const ref = useRef<HTMLElement>(null);
  const { threshold = 0.15, rootMargin = '0px', onceOnly = true } = options;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.classList.add(animationClass);
          if (onceOnly) {
            observer.unobserve(element);
          }
        } else if (!onceOnly) {
          element.classList.remove(animationClass);
        }
      },
      {
        threshold,
        rootMargin,
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [animationClass, threshold, rootMargin, onceOnly]);

  return ref;
}

/**
 * Hook for staggered animations on children
 */
export function useScrollIntoViewStaggered(
  animationClass: string,
  options: UseScrollIntoViewOptions & { staggerDelay?: number } = {},
) {
  const ref = useRef<HTMLElement>(null);
  const { threshold = 0.15, rootMargin = '0px', onceOnly = true, staggerDelay = 100 } = options;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const children = Array.from(element.children) as HTMLElement[];
          children.forEach((child, index) => {
            setTimeout(() => {
              child.classList.add(animationClass);
            }, index * staggerDelay);
          });
          if (onceOnly) {
            observer.unobserve(element);
          }
        } else if (!onceOnly) {
          const children = Array.from(element.children) as HTMLElement[];
          children.forEach((child) => {
            child.classList.remove(animationClass);
          });
        }
      },
      {
        threshold,
        rootMargin,
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [animationClass, threshold, rootMargin, onceOnly, staggerDelay]);

  return ref;
}
