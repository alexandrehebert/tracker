import { ReactNode } from 'react';

interface MapSectionProps {
  eyebrow: ReactNode;
  heading: ReactNode;
  description: ReactNode;
  children: ReactNode;
  sidebarContent?: ReactNode;
  sidebarPosition?: 'left' | 'right';
  bottomRightContent?: ReactNode;
}

export function MapSection({
  eyebrow,
  heading,
  description,
  children,
  sidebarContent,
  sidebarPosition = 'left',
  bottomRightContent,
}: MapSectionProps) {
  return (
    <article className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-[0_24px_90px_rgba(2,6,23,0.4)] backdrop-blur-sm opacity-0 animate-fade-in-up">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="lg:flex lg:min-h-full lg:flex-col lg:justify-center">
          {eyebrow}
          <h2 className="mt-5 text-2xl font-semibold text-white">{heading}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {description}
          </p>
        </div>

        <div className="relative h-72 overflow-hidden rounded-[1.5rem] border border-slate-800/95 bg-slate-950/60 lg:h-80">
          {children}
          {sidebarContent && (
            <div
              aria-hidden="true"
              className={`absolute inset-y-2.5 z-10 w-[30%] min-w-[9rem] overflow-hidden rounded-xl border border-slate-700/90 bg-slate-950/86 shadow-2xl backdrop-blur-sm opacity-0 lg:w-[15rem] ${sidebarPosition === 'right' ? 'right-2.5 animate-fade-in-right' : 'left-2.5 animate-fade-in-left'}`}
              style={{ animationDelay: '800ms' }}
            >
              {sidebarContent}
            </div>
          )}
          {bottomRightContent && (
            <div className="absolute bottom-2.5 right-2.5 z-10 w-32 rounded-lg border border-slate-700/90 bg-slate-950/84 p-1.5 shadow-[0_18px_40px_rgba(2,6,23,0.42)] backdrop-blur-md opacity-0 animate-fade-in-right" style={{ animationDelay: '1000ms' }}>
              {bottomRightContent}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
