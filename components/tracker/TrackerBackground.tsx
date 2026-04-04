'use client';

interface TrackerBackgroundProps {
  showGrid?: boolean;
}

export default function TrackerBackground({ showGrid = false }: TrackerBackgroundProps) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-85"
        style={{
          backgroundImage: [
            'radial-gradient(circle at 14% 14%, rgba(251, 191, 36, 0.18), transparent 30%)',
            'radial-gradient(circle at 84% 18%, rgba(56, 189, 248, 0.16), transparent 28%)',
            'radial-gradient(circle at 52% 82%, rgba(244, 114, 182, 0.10), transparent 30%)',
          ].join(','),
        }}
      />
      {showGrid ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
      ) : null}
    </>
  );
}
