import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FriendsTrackerClient from '~/components/tracker/friends/FriendsTrackerClient';
import type { FriendsTrackerConfig } from '~/lib/friendsTracker';
import type { WorldMapPayload } from '~/lib/server/worldMap';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('~/i18n/navigation', () => ({
  Link: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('~/components/tracker/flight/FlightMap', () => ({
  default: function MockFlightMap({ onInitialZoomEnd }: { onInitialZoomEnd?: () => void }) {
    useEffect(() => {
      onInitialZoomEnd?.();
    }, [onInitialZoomEnd]);

    return <div data-testid="flight-map" />;
  },
}));

const map: WorldMapPayload = {
  countries: [],
  viewBox: { width: 1000, height: 560 },
  projection: { scale: 160, translate: [500, 280] },
};

const initialConfig: FriendsTrackerConfig = {
  updatedAt: null,
  updatedBy: null,
  cronEnabled: true,
  friends: [
    {
      id: 'friend-1',
      name: 'Alice',
      flights: [
        {
          id: 'leg-1',
          flightNumber: 'AF123',
          departureTime: '2026-04-14T09:30:00.000Z',
        },
      ],
    },
  ],
};

describe('FriendsTrackerClient', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(max-width: 1023px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'AF123',
          requestedIdentifiers: ['AF123'],
          matchedIdentifiers: [],
          notFoundIdentifiers: ['AF123'],
          fetchedAt: Date.now(),
          flights: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the transparent gaps in the top action area from blocking map hover targets', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, 'fetch');

    render(<FriendsTrackerClient map={map} initialConfig={initialConfig} airportMarkers={[]} />);

    expect(await screen.findByText(/chantal crew tracker/i)).toBeInTheDocument();

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    const actionArea = refreshButton.parentElement;

    expect(actionArea).toHaveClass('pointer-events-none');

    await user.click(refreshButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tracker?q=AF123&refresh=1', { cache: 'no-store' });
    });
  });
});
