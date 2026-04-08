import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProviderOverrideControls } from '~/components/tracker/providers/ProviderOverrideControls';
import type { ProviderOverridesMap } from '~/lib/server/providers/overrides';

const initialOverrides: ProviderOverridesMap = {
  opensky: 'disabled',
  flightaware: null,
  aviationstack: null,
  aerodatabox: 'enabled',
};

describe('ProviderOverrideControls', () => {
  it('embeds the admin controls inside each provider status card', () => {
    render(
      <ProviderOverrideControls
        initialOverrides={initialOverrides}
        storageConfigured
        providerCards={[
          {
            provider: 'opensky',
            name: 'OpenSky',
            connectionDetail: 'Proxy enabled via the shared Scaleway function.',
            connectionStatusLabel: 'Proxy enabled',
            connectionTone: 'active',
            resourceLinks: [
              { label: 'OpenSky account', href: 'https://opensky-network.org/my-opensky/account' },
            ],
            connectionLinks: [
              { label: 'Scaleway proxy console', href: 'https://console.scaleway.com/functions/namespaces/fr-par/d51f53f6-8a82-452d-96aa-6f4f2cfebfbc/functions' },
            ],
          },
          { provider: 'flightaware', name: 'FlightAware' },
          { provider: 'aviationstack', name: 'Aviationstack' },
          { provider: 'aerodatabox', name: 'AeroDataBox' },
        ]}
        providerStatuses={{
          opensky: {
            defaultStatus: {
              label: 'Enabled',
              detail: 'Enabled with the default environment behavior.',
              tone: 'active',
            },
            forceEnabledStatus: {
              label: 'Enabled',
              detail: 'Enabled by the admin override.',
              tone: 'active',
            },
            forceDisabledStatus: {
              label: 'Disabled',
              detail: 'Disabled because `OPENSKY_DISABLED` is set.',
              tone: 'disabled',
            },
          },
          flightaware: {
            defaultStatus: {
              label: 'Enabled',
              detail: 'Enabled with the default environment behavior.',
              tone: 'active',
            },
            forceEnabledStatus: {
              label: 'Enabled',
              detail: 'Enabled by the admin override.',
              tone: 'active',
            },
            forceDisabledStatus: {
              label: 'Disabled',
              detail: 'Disabled by the admin override.',
              tone: 'disabled',
            },
          },
          aviationstack: {
            defaultStatus: {
              label: 'Disabled',
              detail: 'Disabled until API credentials are configured.',
              tone: 'disabled',
            },
            forceEnabledStatus: {
              label: 'Disabled',
              detail: 'Disabled until API credentials are configured.',
              tone: 'disabled',
            },
            forceDisabledStatus: {
              label: 'Disabled',
              detail: 'Disabled until API credentials are configured.',
              tone: 'disabled',
            },
          },
          aerodatabox: {
            defaultStatus: {
              label: 'Enabled',
              detail: 'Enabled with the default environment behavior.',
              tone: 'active',
            },
            forceEnabledStatus: {
              label: 'Enabled',
              detail: 'Enabled by the admin override.',
              tone: 'active',
            },
            forceDisabledStatus: {
              label: 'Disabled',
              detail: 'Disabled by the admin override.',
              tone: 'disabled',
            },
          },
        }}
      />,
    );

    const openSkyCard = screen.getByText('OpenSky').closest('article');

    expect(screen.queryByRole('heading', { name: /provider admin controls/i })).not.toBeInTheDocument();
    expect(openSkyCard).not.toBeNull();
    expect(within(openSkyCard as HTMLElement).getByText(/current status/i)).toBeInTheDocument();
    expect(within(openSkyCard as HTMLElement).getByText('Disabled')).toBeInTheDocument();
    expect(within(openSkyCard as HTMLElement).getByRole('button', { name: 'Default' })).toBeInTheDocument();
    expect(within(openSkyCard as HTMLElement).getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(within(openSkyCard as HTMLElement).getByRole('button', { name: 'Disable' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(openSkyCard as HTMLElement).queryByText(/admin override/i)).not.toBeInTheDocument();
    expect(within(openSkyCard as HTMLElement).queryByText('Missing config')).not.toBeInTheDocument();
    expect(within(openSkyCard as HTMLElement).getAllByText(/OPENSKY_DISABLED/i)).toHaveLength(1);
    expect(within(openSkyCard as HTMLElement).getByRole('link', { name: /opensky account/i })).toHaveAttribute('href', 'https://opensky-network.org/my-opensky/account');
    expect(within(openSkyCard as HTMLElement).getByRole('link', { name: /scaleway proxy console/i })).toHaveAttribute('href', 'https://console.scaleway.com/functions/namespaces/fr-par/d51f53f6-8a82-452d-96aa-6f4f2cfebfbc/functions');
  });
});
