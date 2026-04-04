import { ReactNode } from 'react';

interface HeroSectionProps {
  title: ReactNode;
  description: ReactNode;
  cta: ReactNode;
  dateRange?: ReactNode;
  metrics: ReactNode;
}

export function HeroSection({
  title,
  description,
  cta,
  dateRange,
  metrics,
}: HeroSectionProps) {
  return (
    <section className="grid items-stretch gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="lg:self-stretch lg:flex lg:flex-col lg:justify-center">
        <div className="opacity-0 animate-fade-in-down">
          <h1 className="text-4xl font-semibold leading-[0.95] text-white sm:text-5xl lg:text-6xl">
            {title}
          </h1>
        </div>
        <div className="opacity-0 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg">
            {description}
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <div>{cta}</div>
          {dateRange ? <div>{dateRange}</div> : null}
        </div>
      </div>

      <div className="grid h-full grid-cols-1 content-center gap-3 opacity-0 animate-fade-in-up [animation-delay:420ms] [&>*]:flex-1 sm:grid-cols-2 lg:max-w-[22rem] lg:grid-cols-2 lg:justify-self-end">
        {metrics}
      </div>
    </section>
  );
}
