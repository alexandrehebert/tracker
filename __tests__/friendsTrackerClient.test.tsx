import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FriendsTrackerClient from '~/components/tracker/friends/FriendsTrackerClient';
import type { FriendsTrackerConfig } from '~/lib/friendsTracker';
import type { WorldMapPayload } from '~/lib/server/worldMap';

let latestFlightMapProps: Record<string, unknown> | null = null;

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
  default: function MockFlightMap(props: { onInitialZoomEnd?: () => void } & Record<string, unknown>) {
    latestFlightMapProps = props;

    useEffect(() => {
      props.onInitialZoomEnd?.();
    }, [props.onInitialZoomEnd]);

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
    latestFlightMapProps = null;

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

  it('passes only one actual map location per friend when a later leg is the live one', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'UX1153,TEST4',
          requestedIdentifiers: ['UX1153', 'TEST4'],
          matchedIdentifiers: ['UX1153', 'TEST4'],
          notFoundIdentifiers: [],
          fetchedAt: Date.now(),
          flights: [
            {
              icao24: 'landed-ux1153',
              callsign: 'AEA1153',
              originCountry: 'Portugal',
              matchedBy: ['UX1153'],
              lastContact: nowSeconds - 4 * 60 * 60,
              current: {
                time: nowSeconds - 4 * 60 * 60,
                latitude: 40.4983,
                longitude: -3.5676,
                x: 380,
                y: 240,
                altitude: 0,
                heading: 70,
                onGround: true,
              },
              originPoint: {
                time: nowSeconds - 5 * 60 * 60,
                latitude: 38.7742,
                longitude: -9.1342,
                x: 350,
                y: 250,
                altitude: 0,
                heading: 70,
                onGround: true,
              },
              track: [],
              rawTrack: [],
              onGround: true,
              velocity: 0,
              heading: 70,
              verticalRate: 0,
              geoAltitude: 0,
              baroAltitude: 0,
              squawk: '1101',
              category: 1,
              route: {
                departureAirport: 'LIS',
                arrivalAirport: 'MAD',
                firstSeen: nowSeconds - 5 * 60 * 60,
                lastSeen: nowSeconds - 4 * 60 * 60,
              },
              dataSource: 'opensky',
              sourceDetails: [],
            },
            {
              icao24: 'live-test4',
              callsign: 'IBE004',
              originCountry: 'Spain',
              matchedBy: ['TEST4'],
              lastContact: nowSeconds - 30,
              current: {
                time: nowSeconds - 30,
                latitude: 44.2,
                longitude: -21.4,
                x: 420,
                y: 210,
                altitude: 10400,
                heading: 280,
                onGround: false,
              },
              originPoint: {
                time: nowSeconds - 5000,
                latitude: 40.4983,
                longitude: -3.5676,
                x: 380,
                y: 240,
                altitude: 0,
                heading: 280,
                onGround: true,
              },
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: 245,
              heading: 280,
              verticalRate: 0,
              geoAltitude: 10400,
              baroAltitude: 10440,
              squawk: '4451',
              category: 1,
              route: {
                departureAirport: 'MAD',
                arrivalAirport: 'JFK',
                firstSeen: nowSeconds - 5400,
                lastSeen: null,
              },
              dataSource: 'opensky',
              sourceDetails: [],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const connectingConfig: FriendsTrackerConfig = {
      ...initialConfig,
      destinationAirport: 'JFK',
      friends: [
        {
          id: 'friend-1',
          name: 'Emma Demo',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'UX1153',
              departureTime: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
              from: 'LIS',
              to: 'MAD',
            },
            {
              id: 'leg-2',
              flightNumber: 'TEST4',
              departureTime: new Date(Date.now() - 85 * 60 * 1000).toISOString(),
              from: 'MAD',
              to: 'JFK',
            },
          ],
        },
      ],
    };

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={connectingConfig}
        airportMarkers={[
          { id: 'lis', code: 'LIS', label: 'Lisbon', latitude: 38.7742, longitude: -9.1342, usage: 'both' },
          { id: 'mad', code: 'MAD', label: 'Madrid', latitude: 40.4983, longitude: -3.5676, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/chantal crew tracker/i)).toBeInTheDocument();

    await waitFor(() => {
      const flights = latestFlightMapProps?.flights as Array<{ icao24: string }> | undefined;
      const flightAvatars = latestFlightMapProps?.flightAvatars as Record<string, Array<{ friendId: string }>> | undefined;
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{ id: string }> | undefined;

      expect(flights?.map((flight) => flight.icao24)).toEqual(['live-test4']);
      expect(flightAvatars?.['live-test4']?.map((entry) => entry.friendId)).toEqual(['friend-1']);
      expect(staticFriendMarkers?.some((marker) => marker.id === 'friend-1')).toBe(false);
    });
  });

  it('keeps a friend pinned to the most recent known airport when no live track is available', async () => {
    const pastOnlyConfig: FriendsTrackerConfig = {
      ...initialConfig,
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
              from: 'LIS',
              to: 'MAD',
            },
          ],
        },
      ],
    };

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={pastOnlyConfig}
        airportMarkers={[
          { id: 'lis', code: 'LIS', label: 'Lisbon', latitude: 38.7742, longitude: -9.1342, usage: 'both' },
          { id: 'mad', code: 'MAD', label: 'Madrid', latitude: 40.4983, longitude: -3.5676, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/chantal crew tracker/i)).toBeInTheDocument();

    await waitFor(() => {
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{
        id: string;
        latitude: number;
        longitude: number;
      }> | undefined;

      expect(staticFriendMarkers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'friend-1',
            latitude: 40.4983,
            longitude: -3.5676,
          }),
        ]),
      );
    });
  });

  it('keeps fallback friend markers aligned with the selected wayback moment', async () => {
    const nowMs = Date.now();

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'AF123,IB456',
          requestedIdentifiers: ['AF123', 'IB456'],
          matchedIdentifiers: [],
          notFoundIdentifiers: ['AF123', 'IB456'],
          fetchedAt: nowMs,
          flights: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-1',
              name: 'Alice',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: new Date(nowMs - 6 * 60 * 60 * 1000).toISOString(),
                  from: 'LIS',
                  to: 'MAD',
                },
                {
                  id: 'leg-2',
                  flightNumber: 'IB456',
                  departureTime: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
                  from: 'MAD',
                  to: 'JFK',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'lis', code: 'LIS', label: 'Lisbon', latitude: 38.7742, longitude: -9.1342, usage: 'both' },
          { id: 'mad', code: 'MAD', label: 'Madrid', latitude: 40.4983, longitude: -3.5676, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    const slider = await screen.findByLabelText(/wayback machine/i);
    expect(slider).toHaveAttribute('type', 'range');

    await waitFor(() => {
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{
        id: string;
        latitude: number;
        longitude: number;
      }> | undefined;

      expect(staticFriendMarkers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'friend-1',
            latitude: 40.6413,
            longitude: -73.7781,
          }),
        ]),
      );
    });

    fireEvent.input(slider, {
      target: { value: String(nowMs - 3 * 60 * 60 * 1000) },
    });

    await waitFor(() => {
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{
        id: string;
        latitude: number;
        longitude: number;
      }> | undefined;

      expect(staticFriendMarkers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'friend-1',
            latitude: 40.4983,
            longitude: -3.5676,
          }),
        ]),
      );
    });
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

  it('rewinds the crew map when the wayback slider is moved back through the trip', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const earlierHistoricalPointTime = nowSeconds - (90 * 60);
    const historicalPointTime = nowSeconds - (45 * 60);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'AF123',
          requestedIdentifiers: ['AF123'],
          matchedIdentifiers: ['AF123'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
          flights: [
            {
              icao24: 'abc123',
              callsign: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds - 30,
              current: {
                time: nowSeconds - 30,
                latitude: 53.94,
                longitude: -31.25,
                x: 0,
                y: 0,
                altitude: 10650,
                heading: 290,
                onGround: false,
              },
              originPoint: {
                time: nowSeconds - 3 * 60 * 60,
                latitude: 49.0097,
                longitude: 2.5479,
                x: 0,
                y: 0,
                altitude: 0,
                heading: 290,
                onGround: true,
              },
              track: [
                {
                  time: nowSeconds - 75 * 60,
                  latitude: 50.45,
                  longitude: -4.2,
                  x: 0,
                  y: 0,
                  altitude: 9200,
                  heading: 285,
                  onGround: false,
                },
                {
                  time: historicalPointTime,
                  latitude: 52.31,
                  longitude: -18.8,
                  x: 0,
                  y: 0,
                  altitude: 10100,
                  heading: 288,
                  onGround: false,
                },
              ],
              rawTrack: [],
              onGround: false,
              velocity: 247,
              heading: 290,
              verticalRate: 0,
              geoAltitude: 10650,
              baroAltitude: 10690,
              squawk: '2201',
              category: 1,
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'JFK',
                firstSeen: nowSeconds - 2 * 60 * 60,
                lastSeen: null,
              },
              dataSource: 'opensky',
              sourceDetails: [],
              fetchHistory: [
                {
                  id: `abc123:search:${nowMs - 90 * 60 * 1000}`,
                  capturedAt: nowMs - 90 * 60 * 1000,
                  trigger: 'search',
                  dataSource: 'opensky',
                  matchedBy: ['AF123'],
                  route: {
                    departureAirport: 'CDG',
                    arrivalAirport: 'JFK',
                    firstSeen: nowSeconds - 2 * 60 * 60,
                    lastSeen: null,
                  },
                  current: {
                    time: nowSeconds - 90 * 60,
                    latitude: 49.8,
                    longitude: -1.8,
                    x: 0,
                    y: 0,
                    altitude: 6100,
                    heading: 284,
                    onGround: false,
                  },
                  onGround: false,
                  lastContact: nowSeconds - 90 * 60,
                  velocity: 230,
                  heading: 284,
                  geoAltitude: 6100,
                  baroAltitude: 6120,
                  flightNumber: 'AF123',
                  airline: null,
                  aircraft: null,
                  departureAirport: null,
                  arrivalAirport: null,
                  sourceDetails: [],
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-1',
              name: 'Alice',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
                  from: 'CDG',
                  to: 'JFK',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris CDG', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    const slider = await screen.findByLabelText(/wayback machine/i);
    expect(slider).toHaveAttribute('type', 'range');

    await waitFor(() => {
      const liveFlight = (latestFlightMapProps?.flights as Array<{ current?: { time?: number | null } }> | undefined)?.[0];
      expect(liveFlight?.current?.time).toBe(nowSeconds - 30);
    });

    fireEvent.input(slider, {
      target: { value: String((earlierHistoricalPointTime * 1000) + 1_000) },
    });

    let earlierCursorLeft = '';
    await waitFor(() => {
      const rewoundFlight = (latestFlightMapProps?.flights as Array<{ current?: { time?: number | null }; onGround?: boolean }> | undefined)?.[0];
      expect(rewoundFlight?.current?.time).toBe(earlierHistoricalPointTime);
      expect(rewoundFlight?.onGround).toBe(false);

      const earlierPlane = screen.getByLabelText(/flight af123/i);
      earlierCursorLeft = earlierPlane.parentElement?.style.left ?? '';
      expect(earlierCursorLeft).not.toBe('');
    });

    fireEvent.input(slider, {
      target: { value: String((historicalPointTime * 1000) + 1_000) },
    });

    await waitFor(() => {
      const rewoundFlight = (latestFlightMapProps?.flights as Array<{ current?: { time?: number | null }; track?: Array<{ time?: number | null }>; onGround?: boolean }> | undefined)?.[0];
      expect(rewoundFlight?.current?.time).toBe(historicalPointTime);
      expect(rewoundFlight?.track?.every((point) => (point.time ?? 0) <= historicalPointTime)).toBe(true);
      expect(rewoundFlight?.onGround).toBe(false);
    });

    const laterPlane = screen.getByLabelText(/flight af123/i);
    const laterCursorLeft = laterPlane.parentElement?.style.left ?? '';
    expect(laterCursorLeft).not.toBe(earlierCursorLeft);
    expect(screen.getByText(/historical snapshot/i)).toBeInTheDocument();

    fireEvent.input(slider, {
      target: { value: String(nowMs - (2 * 60 * 1000)) },
    });

    await waitFor(() => {
      expect(screen.getByText(/live now/i)).toBeInTheDocument();
      const liveFlight = (latestFlightMapProps?.flights as Array<{ current?: { time?: number | null } }> | undefined)?.[0];
      expect(liveFlight?.current?.time).toBe(nowSeconds - 30);
    });
  });

  it('opens the wayback machine from a mobile top-bar button', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: true,
        media: '(max-width: 1023px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'AF123',
          requestedIdentifiers: ['AF123'],
          matchedIdentifiers: ['AF123'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
          flights: [
            {
              icao24: 'abc123',
              callsign: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds - 30,
              current: {
                time: nowSeconds - 30,
                latitude: 53.94,
                longitude: -31.25,
                x: 0,
                y: 0,
                altitude: 10650,
                heading: 290,
                onGround: false,
              },
              originPoint: {
                time: nowSeconds - 3 * 60 * 60,
                latitude: 49.0097,
                longitude: 2.5479,
                x: 0,
                y: 0,
                altitude: 0,
                heading: 290,
                onGround: true,
              },
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: 247,
              heading: 290,
              verticalRate: 0,
              geoAltitude: 10650,
              baroAltitude: 10690,
              squawk: '2201',
              category: 1,
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'JFK',
                firstSeen: nowSeconds - 2 * 60 * 60,
                lastSeen: null,
              },
              dataSource: 'opensky',
              sourceDetails: [],
              fetchHistory: [
                {
                  id: `abc123:search:${nowMs - 90 * 60 * 1000}`,
                  capturedAt: nowMs - 90 * 60 * 1000,
                  trigger: 'search',
                  dataSource: 'opensky',
                  matchedBy: ['AF123'],
                  route: {
                    departureAirport: 'CDG',
                    arrivalAirport: 'JFK',
                    firstSeen: nowSeconds - 2 * 60 * 60,
                    lastSeen: null,
                  },
                  current: {
                    time: nowSeconds - 90 * 60,
                    latitude: 49.8,
                    longitude: -1.8,
                    x: 0,
                    y: 0,
                    altitude: 6100,
                    heading: 284,
                    onGround: false,
                  },
                  onGround: false,
                  lastContact: nowSeconds - 90 * 60,
                  velocity: 230,
                  heading: 284,
                  geoAltitude: 6100,
                  baroAltitude: 6120,
                  flightNumber: 'AF123',
                  airline: null,
                  aircraft: null,
                  departureAirport: null,
                  arrivalAirport: null,
                  sourceDetails: [],
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-1',
              name: 'Alice',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
                  from: 'CDG',
                  to: 'JFK',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris CDG', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/chantal crew tracker/i)).toBeInTheDocument();

    const user = userEvent.setup();
    const openWaybackButton = screen.getByRole('button', { name: /open wayback machine/i });

    await user.click(openWaybackButton);
    expect(await screen.findByRole('slider', { name: /wayback machine/i })).toBeInTheDocument();

    await user.click(openWaybackButton);
    await waitFor(() => {
      expect(screen.queryByRole('slider', { name: /wayback machine/i })).not.toBeInTheDocument();
    });

    await user.click(openWaybackButton);
    expect(await screen.findByRole('slider', { name: /wayback machine/i })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('slider', { name: /wayback machine/i })).not.toBeInTheDocument();
    });
  });

  it('renders the active flight cursor inline with the timeline and rotates it to the live heading', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'AF123',
          requestedIdentifiers: ['AF123'],
          matchedIdentifiers: ['AF123'],
          notFoundIdentifiers: [],
          fetchedAt: Date.now(),
          flights: [
            {
              icao24: 'abc123',
              callsign: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds,
              current: {
                time: nowSeconds,
                latitude: 53.94,
                longitude: -31.25,
                x: 0,
                y: 0,
                altitude: 10650,
                heading: 290,
                onGround: false,
              },
              originPoint: {
                time: nowSeconds - 3600,
                latitude: 51.47,
                longitude: -0.45,
                x: 0,
                y: 0,
                altitude: 0,
                heading: 290,
                onGround: true,
              },
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: 247,
              heading: 290,
              verticalRate: 0,
              geoAltitude: 10650,
              baroAltitude: 10690,
              squawk: '2201',
              category: 1,
              route: {
                departureAirport: 'LHR',
                arrivalAirport: 'JFK',
                firstSeen: nowSeconds - 5400,
                lastSeen: null,
              },
              dataSource: 'opensky',
              sourceDetails: [],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const liveConfig: FriendsTrackerConfig = {
      ...initialConfig,
      destinationAirport: 'JFK',
      friends: [
        {
          ...initialConfig.friends[0]!,
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
              from: 'LHR',
              to: 'JFK',
            },
          ],
        },
      ],
    };

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={liveConfig}
        airportMarkers={[
          { id: 'lhr', code: 'LHR', label: 'London Heathrow', latitude: 51.47, longitude: -0.4543, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    const plane = await screen.findByLabelText(/flight af123/i);

    expect(plane).toHaveStyle({ transform: 'rotate(45deg)' });
    expect(plane.parentElement).toHaveStyle({ transform: 'translate(-50%, -50%)' });
  });

  it('shows not-started, in-flight, and arrived states across demo-style friends', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST1,TEST2,TEST3',
          requestedIdentifiers: ['TEST1', 'TEST2', 'TEST3'],
          matchedIdentifiers: ['TEST1', 'TEST2', 'TEST3'],
          notFoundIdentifiers: [],
          fetchedAt: Date.now(),
          flights: [
            {
              icao24: 'demo-test1',
              callsign: 'AFR006',
              originCountry: 'France',
              matchedBy: ['TEST1'],
              lastContact: nowSeconds - 45,
              current: { time: nowSeconds - 45, latitude: 49.01, longitude: 2.55, x: 0, y: 0, altitude: 0, heading: 95, onGround: true },
              originPoint: { time: nowSeconds - 240, latitude: 49.0088, longitude: 2.5486, x: 0, y: 0, altitude: 0, heading: 90, onGround: true },
              track: [], rawTrack: [], onGround: true, velocity: 12, heading: 95, verticalRate: 0, geoAltitude: 0, baroAltitude: 0,
              squawk: '1001', category: 0,
              route: { departureAirport: 'CDG', arrivalAirport: 'JFK', firstSeen: null, lastSeen: null },
              dataSource: 'opensky', sourceDetails: [],
            },
            {
              icao24: 'demo-test2',
              callsign: 'BAW117',
              originCountry: 'United Kingdom',
              matchedBy: ['TEST2'],
              lastContact: nowSeconds - 75,
              current: { time: nowSeconds - 75, latitude: 53.94, longitude: -31.25, x: 0, y: 0, altitude: 10650, heading: 291, onGround: false },
              originPoint: { time: nowSeconds - 4200, latitude: 52.62, longitude: -8.41, x: 0, y: 0, altitude: 7200, heading: 287, onGround: false },
              track: [], rawTrack: [], onGround: false, velocity: 247, heading: 291, verticalRate: 0, geoAltitude: 10650, baroAltitude: 10690,
              squawk: '2201', category: 1,
              route: { departureAirport: 'LHR', arrivalAirport: 'JFK', firstSeen: nowSeconds - 5400, lastSeen: null },
              dataSource: 'opensky', sourceDetails: [],
            },
            {
              icao24: 'demo-test3',
              callsign: 'DAL220',
              originCountry: 'United States',
              matchedBy: ['TEST3'],
              lastContact: nowSeconds - 90,
              current: { time: nowSeconds - 90, latitude: 40.6413, longitude: -73.7781, x: 0, y: 0, altitude: 0, heading: 89, onGround: true },
              originPoint: { time: nowSeconds - 3600, latitude: 33.6407, longitude: -84.4277, x: 0, y: 0, altitude: 0, heading: 45, onGround: true },
              track: [], rawTrack: [], onGround: true, velocity: 6, heading: 89, verticalRate: 0, geoAltitude: 0, baroAltitude: 0,
              squawk: '1453', category: 1,
              route: { departureAirport: 'ATL', arrivalAirport: 'JFK', firstSeen: nowSeconds - 4800, lastSeen: nowSeconds - 120 },
              dataSource: 'opensky', sourceDetails: [],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const demoConfig: FriendsTrackerConfig = {
      ...initialConfig,
      destinationAirport: 'JFK',
      friends: [
        {
          id: 'friend-1',
          name: 'Alice Demo',
          flights: [{ id: 'leg-1', flightNumber: 'TEST1', departureTime: new Date(Date.now() + 45 * 60 * 1000).toISOString(), from: 'CDG', to: 'JFK' }],
        },
        {
          id: 'friend-2',
          name: 'Bruno Demo',
          flights: [{ id: 'leg-2', flightNumber: 'TEST2', departureTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), from: 'LHR', to: 'JFK' }],
        },
        {
          id: 'friend-3',
          name: 'Chloe Demo',
          flights: [{ id: 'leg-3', flightNumber: 'TEST3', departureTime: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), from: 'ATL', to: 'JFK' }],
        },
      ],
    };

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={demoConfig}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris Charles de Gaulle', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'lhr', code: 'LHR', label: 'London Heathrow', latitude: 51.47, longitude: -0.4543, usage: 'both' },
          { id: 'atl', code: 'ATL', label: 'Atlanta', latitude: 33.6407, longitude: -84.4277, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/alice demo/i)).toBeInTheDocument();
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
    expect(screen.getByText(/in flight/i)).toBeInTheDocument();
    expect(screen.getByText(/arrived/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/flight test1 ready for departure/i)).not.toHaveAttribute('style');
    expect(screen.getByLabelText(/flight test3 arrived/i)).not.toHaveAttribute('style');

    const aliceCard = screen.getByText(/alice demo/i).closest('article');
    const chloeCard = screen.getByText(/chloe demo/i).closest('article');

    const alicePlane = within(aliceCard!).getByLabelText(/flight test1/i);
    const chloePlane = within(chloeCard!).getByLabelText(/flight test3/i);

    expect(alicePlane.parentElement).toHaveStyle({
      left: 'calc(7px + 0 * (100% - 14px))',
    });
    expect(alicePlane).not.toHaveAttribute('style');

    expect(chloePlane.parentElement).toHaveStyle({
      left: 'calc(7px + 1 * (100% - 14px))',
    });
    expect(chloePlane).not.toHaveAttribute('style');
  });

  it('anchors a connection-stop cursor directly on the middle airport dot', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST5,KL641',
          requestedIdentifiers: ['TEST5', 'KL641'],
          matchedIdentifiers: ['TEST5'],
          notFoundIdentifiers: ['KL641'],
          fetchedAt: Date.now(),
          flights: [
            {
              icao24: 'demo-test5',
              callsign: 'KLM1698',
              originCountry: 'Netherlands',
              matchedBy: ['TEST5'],
              lastContact: nowSeconds - 120,
              current: { time: nowSeconds - 120, latitude: 52.3086, longitude: 4.7639, x: 0, y: 0, altitude: 0, heading: 88, onGround: true },
              originPoint: { time: nowSeconds - 5400, latitude: 41.2974, longitude: 2.0833, x: 0, y: 0, altitude: 0, heading: 45, onGround: true },
              track: [], rawTrack: [], onGround: true, velocity: 8, heading: 88, verticalRate: 0, geoAltitude: 0, baroAltitude: 0,
              squawk: '4521', category: 0,
              route: { departureAirport: 'BCN', arrivalAirport: 'AMS', firstSeen: nowSeconds - 5400, lastSeen: nowSeconds - 900 },
              dataSource: 'opensky', sourceDetails: [],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const connectionConfig: FriendsTrackerConfig = {
      ...initialConfig,
      destinationAirport: 'JFK',
      friends: [
        {
          ...initialConfig.friends[0]!,
          name: 'Diego Demo',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'TEST5',
              departureTime: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
              from: 'BCN',
              to: 'AMS',
            },
            {
              id: 'leg-2',
              flightNumber: 'KL641',
              departureTime: new Date(Date.now() + 70 * 60 * 1000).toISOString(),
              from: 'AMS',
              to: 'JFK',
            },
          ],
        },
      ],
    };

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={connectionConfig}
        airportMarkers={[
          { id: 'bcn', code: 'BCN', label: 'Barcelona', latitude: 41.2974, longitude: 2.0833, usage: 'both' },
          { id: 'ams', code: 'AMS', label: 'Amsterdam Schiphol', latitude: 52.3086, longitude: 4.7639, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/diego demo/i)).toBeInTheDocument();

    const plane = screen.getByLabelText(/flight kl641/i).parentElement;

    expect(plane?.getAttribute('style')).toMatch(/left:\s*calc\(7px \+ .* \* \(100% - 14px\)\)/);
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
