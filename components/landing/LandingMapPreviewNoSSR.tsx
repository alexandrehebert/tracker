'use client';

import dynamic from 'next/dynamic';

const LandingMapPreview = dynamic(() => import('~/components/landing/LandingMapPreview'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="absolute inset-0" />,
});

interface LandingMapPreviewNoSSRProps {
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

export function LandingMapPreviewNoSSR(props: LandingMapPreviewNoSSRProps) {
  return <LandingMapPreview {...props} />;
}
