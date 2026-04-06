'use client';

const TRACKER_OCEAN_FILL = '#061729';
const TRACKER_GRID_IMAGE =
  'linear-gradient(rgba(125,211,252,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.09) 1px, transparent 1px)';

interface TrackerBackgroundProps {
  showGrid?: boolean;
}

export default function TrackerBackground({ showGrid = false }: TrackerBackgroundProps) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: TRACKER_OCEAN_FILL,
          backgroundImage: showGrid ? TRACKER_GRID_IMAGE : undefined,
          backgroundSize: showGrid ? '26px 26px' : undefined,
          backgroundPosition: showGrid ? 'center center' : undefined,
        }}
      />
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
    </>
  );
}
