import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FriendsTrackerClient from '~/components/tracker/friends/FriendsTrackerClient';
import type { FriendsTrackerConfig } from '~/lib/friendsTracker';
import type { WorldMapPayload } from '~/lib/server/worldMap';

let latestFlightMapProps: Record<string, unknown> | null = null;
let mockSearchParams = '';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearchParams),
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
    mockSearchParams = '';
    window.history.replaceState({}, '', '/en/chantal');

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

  it('selects and shares a focused friend when a map marker is chosen', async () => {
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
              flightNumber: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds - 30,
              current: {
                time: nowSeconds - 30,
                latitude: 48.9,
                longitude: 2.4,
                x: 420,
                y: 220,
                altitude: 10300,
                heading: 280,
                onGround: false,
              },
              originPoint: {
                time: nowSeconds - 3600,
                latitude: 49.0097,
                longitude: 2.5479,
                x: 410,
                y: 225,
                altitude: 0,
                heading: 280,
                onGround: true,
              },
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: 240,
              heading: 280,
              verticalRate: 0,
              geoAltitude: 10300,
              baroAltitude: 10350,
              squawk: '2201',
              category: 1,
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'LIS',
                firstSeen: nowSeconds - 3600,
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'LIS',
          friends: [
            {
              ...initialConfig.friends[0]!,
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
                  from: 'CDG',
                  to: 'LIS',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris CDG', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'lis', code: 'LIS', label: 'Lisbon', latitude: 38.7742, longitude: -9.1342, usage: 'both' },
        ]}
      />,
    );

    const aliceCard = await screen.findByRole('button', { name: /focus alice on map/i });

    await waitFor(() => {
      expect(typeof latestFlightMapProps?.onSelectFriend).toBe('function');
    });

    await act(async () => {
      (latestFlightMapProps?.onSelectFriend as ((friendId: string) => void))('friend-1');
    });

    await waitFor(() => {
      expect(latestFlightMapProps?.selectedIcao24).toBe('abc123');
    });

    expect(aliceCard).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toContain('friend=Alice');
  });

  it('clears the focused friend when the map background is clicked', async () => {
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
              flightNumber: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds - 30,
              current: {
                time: nowSeconds - 30,
                latitude: 48.9,
                longitude: 2.4,
                x: 420,
                y: 220,
                altitude: 10300,
                heading: 280,
                onGround: false,
              },
              originPoint: {
                time: nowSeconds - 3600,
                latitude: 49.0097,
                longitude: 2.5479,
                x: 410,
                y: 225,
                altitude: 0,
                heading: 280,
                onGround: true,
              },
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: 240,
              heading: 280,
              verticalRate: 0,
              geoAltitude: 10300,
              baroAltitude: 10350,
              squawk: '2201',
              category: 1,
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'LIS',
                firstSeen: nowSeconds - 3600,
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'LIS',
          friends: [
            {
              ...initialConfig.friends[0]!,
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
                  from: 'CDG',
                  to: 'LIS',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris CDG', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'lis', code: 'LIS', label: 'Lisbon', latitude: 38.7742, longitude: -9.1342, usage: 'both' },
        ]}
      />,
    );

    const aliceCard = await screen.findByRole('button', { name: /focus alice on map/i });

    await waitFor(() => {
      expect(typeof latestFlightMapProps?.onSelectFriend).toBe('function');
      expect(typeof latestFlightMapProps?.onClearSelection).toBe('function');
    });

    await act(async () => {
      (latestFlightMapProps?.onSelectFriend as ((friendId: string) => void))('friend-1');
    });

    await waitFor(() => {
      expect(aliceCard).toHaveAttribute('aria-pressed', 'true');
      expect(window.location.search).toContain('friend=Alice');
    });

    await act(async () => {
      (latestFlightMapProps?.onClearSelection as (() => void))();
    });

    await waitFor(() => {
      expect(aliceCard).toHaveAttribute('aria-pressed', 'false');
      expect(window.location.search).not.toContain('friend=Alice');
    });
  });

  it('hydrates a focused friend from the query string and keeps a pinned friend selected', async () => {
    mockSearchParams = 'friend=Maya';
    window.history.replaceState({}, '', '/en/chantal?friend=Maya');

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          friends: [
            {
              id: 'friend-quiet',
              name: 'Maya',
              currentAirport: 'JFK',
              flights: [],
            },
          ],
        }}
        airportMarkers={[
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    const mayaCard = await screen.findByRole('button', { name: /focus maya on map/i });

    await waitFor(() => {
      expect(mayaCard).toHaveAttribute('aria-pressed', 'true');
      expect(latestFlightMapProps?.selectedIcao24).toBe(null);
      expect(latestFlightMapProps?.selectedFriendMarker).toEqual(
        expect.objectContaining({
          id: 'friend-quiet',
          latitude: 40.6413,
          longitude: -73.7781,
        }),
      );
    });
  });

  it('opens Flightradar24 from the timeline plane icon', async () => {
    const user = userEvent.setup();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

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
              flightNumber: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds - 30,
              current: {
                time: nowSeconds - 30,
                latitude: 48.9,
                longitude: -20.4,
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
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
        }}
        airportMarkers={[
          { id: 'lhr', code: 'LHR', label: 'London Heathrow', latitude: 51.47, longitude: -0.4543, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /open af123 on flightradar24/i }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://www.flightradar24.com/AF123',
      '_blank',
      'noopener,noreferrer',
    );
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

  it('shows a map test banner when the current trip is the built-in demo trip', async () => {
    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          currentTripId: 'demo-test-trip',
          trips: [
            {
              id: 'trip-1',
              name: 'Lisbon',
              destinationAirport: 'LIS',
              friends: initialConfig.friends,
            },
            {
              id: 'demo-test-trip',
              name: 'Demo / Test Trip',
              destinationAirport: 'JFK',
              isDemo: true,
              friends: [
                {
                  id: 'friend-demo',
                  name: 'Alice Demo',
                  flights: [
                    {
                      id: 'leg-demo',
                      flightNumber: 'TEST1',
                      departureTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    },
                  ],
                },
              ],
            },
          ],
          friends: [
            {
              id: 'friend-demo',
              name: 'Alice Demo',
              flights: [
                {
                  id: 'leg-demo',
                  flightNumber: 'TEST1',
                  departureTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                },
              ],
            },
          ],
        }}
        airportMarkers={[]}
      />,
    );

    expect(await screen.findByText(/test trip.*demo \/ test trip/i)).toBeInTheDocument();
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

  it('keeps a friend at the departure airport when matched flight is on-ground without GPS and departure time just passed', async () => {
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
              icao24: 'abc-onground',
              callsign: 'AF123',
              flightNumber: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds - 5,
              current: null,
              originPoint: null,
              track: [],
              rawTrack: [],
              onGround: true,
              velocity: 0,
              heading: null,
              verticalRate: null,
              geoAltitude: null,
              baroAltitude: null,
              squawk: null,
              category: null,
              route: {
                departureAirport: 'LIS',
                arrivalAirport: 'MAD',
                firstSeen: null,
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          friends: [
            {
              id: 'friend-1',
              name: 'Alice',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'AF123',
                  departureTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
                  from: 'LIS',
                  to: 'MAD',
                },
              ],
            },
          ],
        }}
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
            latitude: 38.7742,
            longitude: -9.1342,
          }),
        ]),
      );
    });
  });

  it('keeps a departed connection leg in-flight on the timeline until its scheduled arrival when no telemetry is available yet', async () => {
    const nowMs = Date.UTC(2026, 3, 12, 17, 0, 0);
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'LX325,LX176',
          requestedIdentifiers: ['LX325', 'LX176'],
          matchedIdentifiers: [],
          notFoundIdentifiers: ['LX325', 'LX176'],
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
          destinationAirport: 'SIN',
          friends: [
            {
              id: 'friend-chris',
              name: 'Chris',
              flights: [
                {
                  id: 'leg-lx325',
                  flightNumber: 'LX325',
                  departureTime: '2026-04-12T16:15:00.000Z',
                  arrivalTime: '2026-04-12T18:00:00.000Z',
                  from: 'LHR',
                  to: 'ZRH',
                },
                {
                  id: 'leg-lx176',
                  flightNumber: 'LX176',
                  departureTime: '2026-04-12T20:40:00.000Z',
                  arrivalTime: '2026-04-13T09:10:00.000Z',
                  from: 'ZRH',
                  to: 'SIN',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'lhr', code: 'LHR', label: 'London Heathrow', latitude: 51.47, longitude: -0.4543, usage: 'both' },
          { id: 'zrh', code: 'ZRH', label: 'Zurich', latitude: 47.4581, longitude: 8.5555, usage: 'both' },
          { id: 'sin', code: 'SIN', label: 'Singapore', latitude: 1.3644, longitude: 103.9915, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/chantal crew tracker/i)).toBeInTheDocument();

    const chrisCard = screen.getByRole('button', { name: /focus chris on map/i });
    expect(chrisCard).toHaveTextContent(/in flight/i);
    expect(screen.getByLabelText(/flight lx325/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/flight lx325 arrived/i)).not.toBeInTheDocument();
  });

  it('pins a non-traveler friend to the configured current airport even without any flights', async () => {
    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          friends: [
            {
              id: 'friend-quiet',
              name: 'Maya',
              currentAirport: 'JFK',
              flights: [],
            },
          ],
        }}
        airportMarkers={[
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/maya/i)).toBeInTheDocument();

    const mayaCard = screen.getByText(/maya/i).closest('article');
    expect(mayaCard).not.toHaveTextContent(/awaiting/i);
    expect(mayaCard).not.toHaveTextContent(/current airport:/i);

    await waitFor(() => {
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{
        id: string;
        latitude: number;
        longitude: number;
      }> | undefined;

      expect(staticFriendMarkers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'friend-quiet',
            latitude: 40.6413,
            longitude: -73.7781,
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
    expect(slider).toHaveAttribute('step', 'any');

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

  it('keeps a connection-stop friend on the last known airport when the next matched leg has no live position', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST5,KL641',
          requestedIdentifiers: ['TEST5', 'KL641'],
          matchedIdentifiers: ['TEST5', 'KL641'],
          notFoundIdentifiers: [],
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
            {
              icao24: 'fa-klm641-connection',
              callsign: 'KLM641',
              originCountry: 'Unknown',
              matchedBy: ['KL641'],
              lastContact: nowSeconds - 60,
              current: null,
              originPoint: null,
              track: [], rawTrack: [], onGround: false, velocity: null, heading: null, verticalRate: null, geoAltitude: null, baroAltitude: null,
              squawk: null, category: null,
              route: { departureAirport: 'AMS', arrivalAirport: 'JFK', firstSeen: nowSeconds - 60, lastSeen: null },
              dataSource: 'flightaware', sourceDetails: [],
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
        }}
        airportMarkers={[
          { id: 'bcn', code: 'BCN', label: 'Barcelona', latitude: 41.2974, longitude: 2.0833, usage: 'both' },
          { id: 'ams', code: 'AMS', label: 'Amsterdam Schiphol', latitude: 52.3086, longitude: 4.7639, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/diego demo/i)).toBeInTheDocument();

    await waitFor(() => {
      const visibleFlights = latestFlightMapProps?.flights as Array<{ icao24: string }> | undefined;
      expect(visibleFlights?.map((flight) => flight.icao24)).toContain('demo-test5');
      expect(visibleFlights?.map((flight) => flight.icao24)).not.toContain('fa-klm641-connection');
    });
  });

  it('keeps a just-departing live friend pinned to the departure airport when no map point is available yet', async () => {
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
              icao24: 'air-france-pretrack',
              callsign: 'AFR123',
              flightNumber: 'AF123',
              originCountry: 'France',
              matchedBy: ['AF123'],
              lastContact: nowSeconds - 45,
              current: null,
              originPoint: null,
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: null,
              heading: null,
              verticalRate: null,
              geoAltitude: null,
              baroAltitude: null,
              squawk: null,
              category: null,
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'JFK',
                firstSeen: nowSeconds - 45,
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-alex',
              name: 'Alex',
              flights: [
                {
                  id: 'leg-alex-1',
                  flightNumber: 'AF123',
                  departureTime: new Date(nowMs - 15 * 60 * 1000).toISOString(),
                  from: 'CDG',
                  to: 'JFK',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris Charles de Gaulle', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/^alex$/i)).toBeInTheDocument();

    await waitFor(() => {
      const visibleFlights = latestFlightMapProps?.flights as Array<{ icao24: string }> | undefined;
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{
        id: string;
        latitude: number;
        longitude: number;
      }> | undefined;

      expect(visibleFlights?.map((flight) => flight.icao24) ?? []).not.toContain('air-france-pretrack');
      expect(staticFriendMarkers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'friend-alex',
            latitude: 49.0097,
            longitude: 2.5479,
          }),
        ]),
      );
    });
  });

  it('renders a landed route-only match at the arrival airport instead of leaving the friend at departure', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'AF345,MU554',
          requestedIdentifiers: ['AF345', 'MU554'],
          matchedIdentifiers: ['AF345', 'MU554'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
          flights: [
            {
              icao24: 'fa-afr345-yul-cdg',
              callsign: 'AFR345',
              flightNumber: '345',
              originCountry: 'France',
              matchedBy: ['AF345'],
              lastContact: nowSeconds - (20 * 60),
              current: null,
              originPoint: null,
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: null,
              heading: null,
              verticalRate: null,
              geoAltitude: null,
              baroAltitude: null,
              squawk: null,
              category: null,
              route: {
                departureAirport: 'YUL',
                arrivalAirport: 'CDG',
                firstSeen: nowSeconds - (7 * 60 * 60),
                lastSeen: nowSeconds - (20 * 60),
              },
              dataSource: 'airlabs',
              sourceDetails: [],
            },
            {
              icao24: 'fa-ces554-upcoming',
              callsign: 'CES554',
              flightNumber: '554',
              originCountry: 'China',
              matchedBy: ['MU554'],
              lastContact: nowSeconds - (90 * 60),
              current: null,
              originPoint: null,
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: null,
              heading: null,
              verticalRate: null,
              geoAltitude: null,
              baroAltitude: null,
              squawk: null,
              category: null,
              route: {
                departureAirport: 'CDG',
                arrivalAirport: 'PVG',
                firstSeen: nowSeconds - (9 * 60 * 60),
                lastSeen: nowSeconds - (4 * 60 * 60),
              },
              dataSource: 'airlabs',
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'SIN',
          friends: [
            {
              id: 'friend-alex',
              name: 'Alex',
              flights: [
                {
                  id: 'leg-alex-1',
                  flightNumber: 'AF345',
                  departureTime: new Date(nowMs - (7 * 60 * 60 * 1000)).toISOString(),
                  arrivalTime: new Date(nowMs - (20 * 60 * 1000)).toISOString(),
                  from: 'YUL',
                  to: 'CDG',
                },
                {
                  id: 'leg-alex-2',
                  flightNumber: 'MU554',
                  departureTime: new Date(nowMs + (3 * 24 * 60 * 60 * 1000)).toISOString(),
                  from: 'CDG',
                  to: 'PVG',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'yul', code: 'YUL', label: 'Montreal Trudeau', latitude: 45.4706, longitude: -73.7408, usage: 'both' },
          { id: 'cdg', code: 'CDG', label: 'Paris Charles de Gaulle', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'pvg', code: 'PVG', label: 'Shanghai Pudong', latitude: 31.1443, longitude: 121.8083, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/^alex$/i)).toBeInTheDocument();

    await waitFor(() => {
      const visibleFlights = latestFlightMapProps?.flights as Array<{
        icao24: string;
        current?: { latitude: number; longitude: number; onGround: boolean } | null;
        originPoint?: { latitude: number; longitude: number } | null;
        track?: Array<unknown>;
      }> | undefined;
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{ id: string }> | undefined;

      expect(visibleFlights).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            icao24: 'fa-afr345-yul-cdg',
            current: expect.objectContaining({
              latitude: 49.0097,
              longitude: 2.5479,
              onGround: true,
            }),
            originPoint: expect.objectContaining({
              latitude: 45.4706,
              longitude: -73.7408,
            }),
            track: expect.arrayContaining([
              expect.objectContaining({ latitude: 45.4706, longitude: -73.7408 }),
              expect.objectContaining({ latitude: 49.0097, longitude: 2.5479 }),
            ]),
          }),
        ]),
      );
      expect(visibleFlights?.map((flight) => flight.icao24) ?? []).not.toContain('fa-ces554-upcoming');
      expect(staticFriendMarkers?.some((marker) => marker.id === 'friend-alex')).toBe(false);
    });
  });

  it('reacts to a route-seed refresh signal by forcing an immediate tracker refresh', async () => {
    const nowMs = Date.UTC(2026, 3, 11, 9, 40);
    const nowSeconds = Math.floor(nowMs / 1000);
    const fetchMock = vi.spyOn(window, 'fetch');

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        query: 'AF123',
        requestedIdentifiers: ['AF123'],
        matchedIdentifiers: [],
        notFoundIdentifiers: ['AF123'],
        fetchedAt: nowMs,
        flights: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        query: 'AF123',
        requestedIdentifiers: ['AF123'],
        matchedIdentifiers: ['AF123'],
        notFoundIdentifiers: [],
        fetchedAt: nowMs + 1_000,
        flights: [
          {
            icao24: '3c675a',
            callsign: 'AF123',
            flightNumber: 'AF123',
            originCountry: 'France',
            matchedBy: ['AF123'],
            lastContact: nowSeconds,
            current: {
              time: nowSeconds,
              latitude: 48.9,
              longitude: 2.4,
              x: 420,
              y: 220,
              altitude: 10300,
              heading: 280,
              onGround: false,
            },
            originPoint: null,
            track: [],
            rawTrack: [],
            onGround: false,
            velocity: 240,
            heading: 280,
            verticalRate: 0,
            geoAltitude: 10300,
            baroAltitude: 10350,
            squawk: '2201',
            category: 1,
            route: {
              departureAirport: 'CDG',
              arrivalAirport: 'LIS',
              firstSeen: nowSeconds - 3600,
              lastSeen: null,
            },
            dataSource: 'opensky',
            sourceDetails: [],
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const trackedFriend = {
      ...initialConfig.friends[0]!,
      flights: [
        {
          id: 'leg-1',
          flightNumber: 'AF123',
          departureTime: new Date(nowMs - 45 * 60 * 1000).toISOString(),
          from: 'CDG',
          to: 'LIS',
        },
      ],
    };

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          currentTripId: 'main-trip',
          destinationAirport: 'LIS',
          trips: [
            {
              id: 'main-trip',
              name: 'Main trip',
              destinationAirport: 'LIS',
              isDemo: false,
              friends: [trackedFriend],
            },
          ],
          friends: [trackedFriend],
        }}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris CDG', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'lis', code: 'LIS', label: 'Lisbon', latitude: 38.7742, longitude: -9.1342, usage: 'both' },
        ]}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tracker?q=AF123&cacheonly=1', expect.objectContaining({ cache: 'no-store' }));
    });

    window.dispatchEvent(new CustomEvent('chantal:tracker-refresh', {
      detail: { at: nowMs + 5_000, identifiers: ['AF123'] },
    }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tracker?q=AF123&refresh=1', expect.objectContaining({ cache: 'no-store' }));
      const visibleFlights = (latestFlightMapProps?.flights as Array<{ icao24?: string }> | undefined) ?? [];
      expect(visibleFlights.map((flight) => flight.icao24)).toContain('3c675a');
    });
  });

  it('falls back to a live refresh when the initial Chantal cache-only lookup is empty', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const fetchMock = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: 'AF345',
            requestedIdentifiers: ['AF345'],
            matchedIdentifiers: [],
            notFoundIdentifiers: ['AF345'],
            fetchedAt: nowMs,
            flights: [],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: 'AF345',
            requestedIdentifiers: ['AF345'],
            matchedIdentifiers: ['AF345'],
            notFoundIdentifiers: [],
            fetchedAt: nowMs + 1_000,
            flights: [
              {
                icao24: 'fa-afr345-yul-cdg',
                callsign: 'AFR345',
                flightNumber: '345',
                originCountry: 'France',
                matchedBy: ['AF345'],
                lastContact: nowSeconds - (20 * 60),
                current: null,
                originPoint: null,
                track: [],
                rawTrack: [],
                onGround: false,
                velocity: null,
                heading: null,
                verticalRate: null,
                geoAltitude: null,
                baroAltitude: null,
                squawk: null,
                category: null,
                route: {
                  departureAirport: 'YUL',
                  arrivalAirport: 'CDG',
                  firstSeen: nowSeconds - (7 * 60 * 60),
                  lastSeen: nowSeconds - (20 * 60),
                },
                dataSource: 'airlabs',
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          cronEnabled: false,
          destinationAirport: 'SIN',
          friends: [
            {
              id: 'friend-alex',
              name: 'Alex',
              flights: [
                {
                  id: 'leg-alex-1',
                  flightNumber: 'AF345',
                  departureTime: new Date(nowMs - (7 * 60 * 60 * 1000)).toISOString(),
                  arrivalTime: new Date(nowMs - (20 * 60 * 1000)).toISOString(),
                  from: 'YUL',
                  to: 'CDG',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'yul', code: 'YUL', label: 'Montreal Trudeau', latitude: 45.4706, longitude: -73.7408, usage: 'both' },
          { id: 'cdg', code: 'CDG', label: 'Paris Charles de Gaulle', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
        ]}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toContain('refresh=1');
    });

    await waitFor(() => {
      const visibleFlights = latestFlightMapProps?.flights as Array<{ icao24: string }> | undefined;
      expect(visibleFlights?.map((flight) => flight.icao24)).toContain('fa-afr345-yul-cdg');
    });
  });

  it('marks last-known map avatars as stale after extended silence in live mode', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST5',
          requestedIdentifiers: ['TEST5'],
          matchedIdentifiers: ['TEST5'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
          flights: [
            {
              icao24: 'demo-test5',
              callsign: 'KLM1698',
              originCountry: 'Netherlands',
              matchedBy: ['TEST5'],
              lastContact: nowSeconds - (31 * 60),
              current: { time: nowSeconds - (31 * 60), latitude: 52.3086, longitude: 4.7639, x: 0, y: 0, altitude: 0, heading: 88, onGround: true },
              originPoint: { time: nowSeconds - 5400, latitude: 41.2974, longitude: 2.0833, x: 0, y: 0, altitude: 0, heading: 45, onGround: true },
              track: [], rawTrack: [], onGround: true, velocity: 8, heading: 88, verticalRate: 0, geoAltitude: 0, baroAltitude: 0,
              squawk: '4521', category: 0,
              route: { departureAirport: 'BCN', arrivalAirport: 'AMS', firstSeen: nowSeconds - 5400, lastSeen: nowSeconds - (31 * 60) },
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-1',
              name: 'Diego Demo',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'TEST5',
                  departureTime: new Date(nowMs - 4 * 60 * 60 * 1000).toISOString(),
                  from: 'BCN',
                  to: 'AMS',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'bcn', code: 'BCN', label: 'Barcelona', latitude: 41.2974, longitude: 2.0833, usage: 'both' },
          { id: 'ams', code: 'AMS', label: 'Amsterdam Schiphol', latitude: 52.3086, longitude: 4.7639, usage: 'both' },
        ]}
      />,
    );

    expect(await screen.findByText(/diego demo/i)).toBeInTheDocument();

    await waitFor(() => {
      const flightAvatars = latestFlightMapProps?.flightAvatars as Record<string, Array<{ friendId: string; isStale?: boolean }>> | undefined;
      expect(flightAvatars?.['demo-test5']?.[0]?.isStale).toBe(true);
    });
  });

  it('renders the configured friend avatar in the sidebar card with the same color coding as the map', async () => {
    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          friends: [
            {
              ...initialConfig.friends[0]!,
              color: '#f97316',
            },
          ],
        }}
        airportMarkers={[]}
      />,
    );

    expect(await screen.findByText(/chantal crew tracker/i)).toBeInTheDocument();

    const avatarImage = screen.getByRole('img', { name: /alice/i });
    expect(avatarImage).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'));
    const avatarStyle = avatarImage.parentElement?.getAttribute('style') ?? '';
    expect(avatarStyle).toContain('border-color: rgb(249, 115, 22)');
    expect(avatarStyle).toContain('background-color: rgba(249, 115, 22, 0.18)');
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

    const liveButton = screen.getByRole('button', { name: /live/i });
    expect(liveButton).toHaveClass('border-slate-400/30', 'bg-slate-900/70', 'text-slate-100');
    expect(liveButton.querySelector('[aria-hidden="true"]')).toHaveClass('bg-slate-300');

    fireEvent.input(slider, {
      target: { value: String(nowMs - (2 * 60 * 1000)) },
    });

    await waitFor(() => {
      expect(screen.getByText(/live now/i)).toBeInTheDocument();
      const liveFlight = (latestFlightMapProps?.flights as Array<{ current?: { time?: number | null } }> | undefined)?.[0];
      expect(liveFlight?.current?.time).toBe(nowSeconds - 30);
    });
  });

  it('clamps the live wayback range to now and hides future-dated map telemetry', async () => {
    const nowMs = Date.UTC(2026, 3, 11, 9, 22);
    const departureMs = Date.UTC(2026, 3, 10, 23, 6);
    const futurePointMs = Date.UTC(2026, 3, 11, 23, 0);
    const futurePointSeconds = Math.floor(futurePointMs / 1000);
    const fetchedAt = Date.UTC(2026, 3, 11, 9, 8);
    const formatter = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
    const localFormatter = new Intl.DateTimeFormat('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'SQ221',
          requestedIdentifiers: ['SQ221'],
          matchedIdentifiers: ['SQ221'],
          notFoundIdentifiers: [],
          fetchedAt,
          flights: [
            {
              icao24: 'future-sq221',
              callsign: 'SQ221',
              flightNumber: 'SQ221',
              originCountry: 'Singapore',
              matchedBy: ['SQ221'],
              lastContact: futurePointSeconds,
              current: {
                time: futurePointSeconds,
                latitude: -12.5,
                longitude: 129.1,
                x: 0,
                y: 0,
                altitude: 11000,
                heading: 150,
                onGround: false,
              },
              originPoint: null,
              track: [],
              rawTrack: [],
              onGround: false,
              velocity: 245,
              heading: 150,
              verticalRate: 0,
              geoAltitude: 11000,
              baroAltitude: 11020,
              squawk: '2231',
              category: 1,
              route: {
                departureAirport: 'SIN',
                arrivalAirport: 'SYD',
                firstSeen: Math.floor(departureMs / 1000),
                lastSeen: futurePointSeconds,
              },
              dataSource: 'flightaware',
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'SYD',
          friends: [
            {
              id: 'friend-1',
              name: 'Alice',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'SQ221',
                  departureTime: new Date(departureMs).toISOString(),
                  arrivalTime: new Date(futurePointMs).toISOString(),
                  from: 'SIN',
                  to: 'SYD',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'sin', code: 'SIN', label: 'Singapore', latitude: 1.3644, longitude: 103.9915, usage: 'both' },
          { id: 'syd', code: 'SYD', label: 'Sydney', latitude: -33.9399, longitude: 151.1753, usage: 'both' },
        ]}
      />,
    );

    const slider = await screen.findByLabelText(/wayback machine/i);
    expect(await screen.findByText(/live now/i)).toBeInTheDocument();
    expect(screen.getByText(`${formatter.format(nowMs)} UTC`)).toBeInTheDocument();
    expect(screen.getByText(`Local ${localFormatter.format(nowMs)}`)).toBeInTheDocument();
    expect(screen.getByText(/trip start/i)).toBeInTheDocument();
    expect(screen.getByText(`${formatter.format(departureMs)} UTC`)).toBeInTheDocument();
    expect(screen.queryByText('Now (UTC)')).not.toBeInTheDocument();
    expect(slider).toHaveAttribute('max', String(nowMs));
    expect(screen.queryByText(`${formatter.format(futurePointMs)} UTC`)).not.toBeInTheDocument();

    await waitFor(() => {
      const flights = (latestFlightMapProps?.flights as Array<{ icao24?: string }> | undefined) ?? [];
      expect(flights).toHaveLength(0);
    });
  });

  it('interpolates sparse demo telemetry while rewinding so back-in-time steps visibly move the plane', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const rewindTargetSeconds = nowSeconds - (30 * 60);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST2',
          requestedIdentifiers: ['TEST2'],
          matchedIdentifiers: ['TEST2'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
          flights: [
            {
              icao24: 'demo-test2',
              callsign: 'BAW117',
              originCountry: 'United Kingdom',
              matchedBy: ['TEST2'],
              lastContact: nowSeconds - 75,
              current: {
                time: nowSeconds - 75,
                latitude: 53.94,
                longitude: -31.25,
                x: 0,
                y: 0,
                altitude: 10650,
                heading: 291,
                onGround: false,
              },
              originPoint: {
                time: nowSeconds - 4200,
                latitude: 52.62,
                longitude: -8.41,
                x: 0,
                y: 0,
                altitude: 7200,
                heading: 287,
                onGround: false,
              },
              track: [
                {
                  time: nowSeconds - 4200,
                  latitude: 52.62,
                  longitude: -8.41,
                  x: 0,
                  y: 0,
                  altitude: 7200,
                  heading: 287,
                  onGround: false,
                },
                {
                  time: nowSeconds - 2700,
                  latitude: 53.46,
                  longitude: -16.8,
                  x: 0,
                  y: 0,
                  altitude: 10100,
                  heading: 289,
                  onGround: false,
                },
                {
                  time: nowSeconds - 1200,
                  latitude: 53.88,
                  longitude: -24.7,
                  x: 0,
                  y: 0,
                  altitude: 10700,
                  heading: 290,
                  onGround: false,
                },
              ],
              rawTrack: [],
              onGround: false,
              velocity: 247,
              heading: 291,
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-1',
              name: 'Bruno Demo',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'TEST2',
                  departureTime: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
                  from: 'LHR',
                  to: 'JFK',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'lhr', code: 'LHR', label: 'London Heathrow', latitude: 51.47, longitude: -0.4543, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    const slider = await screen.findByLabelText(/wayback machine/i);
    fireEvent.input(slider, {
      target: { value: String((rewindTargetSeconds * 1000) + 1_000) },
    });

    await waitFor(() => {
      const rewoundFlight = (latestFlightMapProps?.flights as Array<{
        current?: { time?: number | null; latitude?: number | null; longitude?: number | null; altitude?: number | null };
      }> | undefined)?.[0];

      expect(rewoundFlight?.current?.time).toBe(rewindTargetSeconds);
      expect(rewoundFlight?.current?.latitude).toBeGreaterThan(53.46);
      expect(rewoundFlight?.current?.latitude).toBeLessThan(53.88);
      expect(rewoundFlight?.current?.longitude).toBeLessThan(-16.8);
      expect(rewoundFlight?.current?.longitude).toBeGreaterThan(-24.7);
      expect(rewoundFlight?.current?.altitude).toBeGreaterThan(10100);
      expect(rewoundFlight?.current?.altitude).toBeLessThan(10700);
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

  it('keeps friend bubble colors stable while rewinding even when other demo flights drop out of telemetry', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST1,TEST2',
          requestedIdentifiers: ['TEST1', 'TEST2'],
          matchedIdentifiers: ['TEST1', 'TEST2'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
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
              name: 'Alice Demo',
              flights: [{ id: 'leg-1', flightNumber: 'TEST1', departureTime: new Date(nowMs + 45 * 60 * 1000).toISOString(), from: 'CDG', to: 'JFK' }],
            },
            {
              id: 'friend-2',
              name: 'Bruno Demo',
              flights: [{ id: 'leg-2', flightNumber: 'TEST2', departureTime: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(), from: 'LHR', to: 'JFK' }],
            },
          ],
        }}
        airportMarkers={[
          { id: 'cdg', code: 'CDG', label: 'Paris Charles de Gaulle', latitude: 49.0097, longitude: 2.5479, usage: 'both' },
          { id: 'lhr', code: 'LHR', label: 'London Heathrow', latitude: 51.47, longitude: -0.4543, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    const slider = await screen.findByLabelText(/wayback machine/i);

    let liveBrunoColor = '';
    let liveBrunoRouteColor = '';
    await waitFor(() => {
      const flightAvatars = latestFlightMapProps?.flightAvatars as Record<string, Array<{ friendId: string; color: string }>> | undefined;
      const flightColors = latestFlightMapProps?.flightColors as Map<string, string> | undefined;
      liveBrunoColor = flightAvatars?.['demo-test2']?.find((entry) => entry.friendId === 'friend-2')?.color ?? '';
      liveBrunoRouteColor = flightColors?.get('demo-test2') ?? '';
      expect(liveBrunoColor).not.toBe('');
      expect(liveBrunoRouteColor).toBe(liveBrunoColor);
    });

    fireEvent.input(slider, {
      target: { value: String(nowMs - (30 * 60 * 1000)) },
    });

    await waitFor(() => {
      const flightAvatars = latestFlightMapProps?.flightAvatars as Record<string, Array<{ friendId: string; color: string }>> | undefined;
      const flightColors = latestFlightMapProps?.flightColors as Map<string, string> | undefined;
      const rewoundBrunoColor = flightAvatars?.['demo-test2']?.find((entry) => entry.friendId === 'friend-2')?.color ?? '';
      const rewoundBrunoRouteColor = flightColors?.get('demo-test2') ?? '';
      expect(rewoundBrunoColor).toBe(liveBrunoColor);
      expect(rewoundBrunoRouteColor).toBe(liveBrunoRouteColor);
      expect(rewoundBrunoRouteColor).toBe(rewoundBrunoColor);
    });
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

  it('falls back to pre-departure states when rewinding demo data before takeoff', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST1,TEST2,TEST3',
          requestedIdentifiers: ['TEST1', 'TEST2', 'TEST3'],
          matchedIdentifiers: ['TEST1', 'TEST2', 'TEST3'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
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
          flights: [{ id: 'leg-1', flightNumber: 'TEST1', departureTime: new Date(nowMs + 45 * 60 * 1000).toISOString(), from: 'CDG', to: 'JFK' }],
        },
        {
          id: 'friend-2',
          name: 'Bruno Demo',
          flights: [{ id: 'leg-2', flightNumber: 'TEST2', departureTime: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(), from: 'LHR', to: 'JFK' }],
        },
        {
          id: 'friend-3',
          name: 'Chloe Demo',
          flights: [{ id: 'leg-3', flightNumber: 'TEST3', departureTime: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(), from: 'ATL', to: 'JFK' }],
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

    const slider = await screen.findByLabelText(/wayback machine/i);
    fireEvent.input(slider, {
      target: { value: String(nowMs - (2 * 60 * 60 * 1000) - (30 * 60 * 1000)) },
    });

    await waitFor(() => {
      expect(screen.getByText(/historical snapshot/i)).toBeInTheDocument();

      const brunoCard = screen.getByText(/bruno demo/i).closest('article');
      expect(brunoCard).toHaveTextContent(/not started/i);
      expect(within(brunoCard!).queryByLabelText(/flight test2/i)).not.toBeInTheDocument();
    });
  });

  it('keeps a landed demo friend pinned to the departure airport before the historical track actually begins', async () => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: 'TEST3',
          requestedIdentifiers: ['TEST3'],
          matchedIdentifiers: ['TEST3'],
          notFoundIdentifiers: [],
          fetchedAt: nowMs,
          flights: [
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

    render(
      <FriendsTrackerClient
        map={map}
        initialConfig={{
          ...initialConfig,
          destinationAirport: 'JFK',
          friends: [
            {
              id: 'friend-1',
              name: 'Chloe Demo',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'TEST3',
                  departureTime: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
                  from: 'ATL',
                  to: 'JFK',
                },
              ],
            },
          ],
        }}
        airportMarkers={[
          { id: 'atl', code: 'ATL', label: 'Atlanta', latitude: 33.6407, longitude: -84.4277, usage: 'both' },
          { id: 'jfk', code: 'JFK', label: 'New York JFK', latitude: 40.6413, longitude: -73.7781, usage: 'both' },
        ]}
      />,
    );

    const slider = await screen.findByLabelText(/wayback machine/i);
    fireEvent.input(slider, {
      target: { value: String(nowMs - (2 * 60 * 60) - (30 * 60 * 1000)) },
    });

    await waitFor(() => {
      const visibleFlight = (latestFlightMapProps?.flights as Array<{
        current?: { latitude?: number | null; longitude?: number | null } | null;
        originPoint?: { latitude?: number | null; longitude?: number | null } | null;
      }> | undefined)?.[0] ?? null;
      const staticFriendMarkers = latestFlightMapProps?.staticFriendMarkers as Array<{
        id: string;
        latitude: number;
        longitude: number;
      }> | undefined;

      if (visibleFlight) {
        const anchoredPoint = visibleFlight.current ?? visibleFlight.originPoint;
        expect(anchoredPoint?.latitude ?? 0).toBeLessThan(39.5);
        expect(anchoredPoint?.longitude ?? 0).toBeLessThan(-75);
        return;
      }

      expect(staticFriendMarkers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'friend-1',
            latitude: 33.6407,
            longitude: -84.4277,
          }),
        ]),
      );
    });
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
