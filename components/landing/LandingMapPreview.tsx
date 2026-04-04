'use client';

interface LandingMapPreviewProps {
  paths: string[];
  highlightedCountryPath?: string;
  previewConnectorPath: string;
  previewPinPoint: { x: number; y: number };
  previewLabelX: number;
  previewLabelY: number;
  previewLabelWidth: number;
  previewLabelHeight: number;
  previewCountryLabel: string;
}

function getMarkerPinPath(size: number): string {
  const xOuter = size * 0.95;
  const yMid = size * 0.9;
  const yTop = size * 2.15;
  const xInner = size * 1.15;
  return `M 0 0 C ${-xOuter} ${-yMid} ${-xInner} ${-yTop} 0 ${-yTop} C ${xInner} ${-yTop} ${xOuter} ${-yMid} 0 0 Z`;
}

export default function LandingMapPreview({
  paths,
  highlightedCountryPath,
  previewConnectorPath,
  previewPinPoint,
  previewLabelX,
  previewLabelY,
  previewLabelWidth,
  previewLabelHeight,
  previewCountryLabel,
}: LandingMapPreviewProps) {
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 420 280" preserveAspectRatio="xMidYMid slice" data-landing-map-preview="true">
      <defs>
        <pattern id="preview-map-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="0.7" />
        </pattern>
        <radialGradient id="preview-map-glow" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="rgba(56,189,248,0.2)" />
          <stop offset="60%" stopColor="rgba(15,23,42,0.16)" />
          <stop offset="100%" stopColor="rgba(2,6,23,0)" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="420" height="280" fill="url(#preview-map-grid)" />
      <rect x="0" y="0" width="420" height="280" fill="url(#preview-map-glow)" />

      <g>
        {paths.map((pathValue, index) => (
          <path
            key={`landing-map-country-${index}`}
            d={pathValue}
            fill="rgba(30,41,59,0.88)"
            stroke="rgba(148,163,184,0.72)"
            strokeWidth="0.7"
          />
        ))}
      </g>

      {highlightedCountryPath ? (
        <path
          d={highlightedCountryPath}
          fill="rgba(52,211,153,0.85)"
          stroke="rgba(209, 250, 229, 1)"
          strokeWidth="1.35"
          vectorEffect="non-scaling-stroke"
          style={{ filter: 'drop-shadow(0 0 16px rgba(16,185,129,0.95))' }}
        />
      ) : null}

      {highlightedCountryPath ? (
        <g>
          <path
            d={previewConnectorPath}
            fill="none"
            stroke="rgba(125,211,252,0.88)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.62"
          />
          <g transform={`translate(${previewPinPoint.x}, ${previewPinPoint.y})`}>
            <path
              d={getMarkerPinPath(6.2)}
              fill="rgba(56,189,248,0.98)"
              stroke="rgba(248,250,252,0.95)"
              strokeWidth="1.1"
            />
          </g>
          <rect
            x={previewLabelX}
            y={previewLabelY}
            rx={8.5}
            ry={8.5}
            width={previewLabelWidth}
            height={previewLabelHeight}
            fill="rgba(2,6,23,0.72)"
            stroke="rgba(125,211,252,0.55)"
            strokeWidth="1.1"
          />
          <text
            x={previewLabelX + previewLabelWidth / 2}
            y={previewLabelY + previewLabelHeight / 2 + 0.5}
            dominantBaseline="central"
            textAnchor="middle"
            fill="rgba(226,232,240,0.94)"
            fontSize="12.2"
            fontWeight="600"
          >
            {previewCountryLabel}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
