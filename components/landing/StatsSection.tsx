import { ReactNode } from 'react';

interface StatSectionProps {
  eyebrow: ReactNode;
  heading: ReactNode;
  description: ReactNode;
  content: ReactNode;
}

export function StatsSection({
  eyebrow,
  heading,
  description,
  content,
}: StatSectionProps) {
  return (
    <div className="opacity-0 animate-fade-in-up">
      <article className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-[0_24px_90px_rgba(2,6,23,0.4)] backdrop-blur-sm">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
          <div className="lg:flex lg:min-h-full lg:flex-col lg:justify-center">
            {eyebrow}
            <h2 className="mt-5 text-2xl font-semibold text-white">{heading}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {description}
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-slate-800/95 bg-slate-950/65 p-4 lg:h-80 overflow-hidden">
            <div>
              {content}
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
