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
      avatarUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%230ea5e9"/></svg>',
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

  it('renders the configured friend avatar in the sidebar card with the same color coding as the map', async () => {
    render(<FriendsTrackerClient map={map} initialConfig={initialConfig} airportMarkers={[]} />);

    expect(await screen.findByText(/chantal crew tracker/i)).toBeInTheDocument();

    const avatarImage = screen.getByRole('img', { name: /alice/i });
    expect(avatarImage).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'));
    expect(avatarImage.parentElement).toHaveStyle({
      borderColor: 'hsl(0, 78%, 64%)',
      backgroundColor: 'hsla(0, 78%, 64%, 0.18)',
    });
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

  it('sizes timeline legs from airport distance while keeping short hops readable', async () => {
    const distanceConfig: FriendsTrackerConfig = {
      ...initialConfig,
      friends: [
        {
          ...initialConfig.friends[0]!,
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
              from: 'ORY',
              to: 'CDG',
            },
            {
              id: 'leg-2',
              flightNumber: 'AF456',
              departureTime: '2026-04-14T12:00:00.000Z',
              from: 'CDG',
              to: 'BRU',
            },
            {
              id: 'leg-3',
              flightNumber: 'AF789',
              departureTime: '2026-04-15T08:00:00.000Z',
              from: 'BRU',
              to: 'JFK',
            },
          ],
        },
      ],
    };

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={distanceConfig}
        airportMarkers={[
          { id: 'ory', code: 'ORY', label: 'Paris Orly', latitude: 48.7262, longitude: 2.3652, usage: 'both' },
          { id: 'cdg', code: 'CDG', label: 'Paris Charles de Gaulle', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'bru', code: 'BRU', label: 'Brussels', latitude: 50.9014, longitude: 4.4844, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/alice/i)).toBeInTheDocument();

    const hopOne = screen.getByTitle(/ory to cdg/i);
    const hopTwo = screen.getByTitle(/cdg to bru/i);
    const longHaul = screen.getByTitle(/bru to jfk/i);

    const hopOneGrow = Number.parseFloat((hopOne as HTMLElement).style.flexGrow);
    const hopTwoGrow = Number.parseFloat((hopTwo as HTMLElement).style.flexGrow);
    const longHaulGrow = Number.parseFloat((longHaul as HTMLElement).style.flexGrow);

    expect(hopOneGrow).toBeCloseTo(hopTwoGrow, 5);
    expect(longHaulGrow).toBeGreaterThan(hopTwoGrow);
  });
});
