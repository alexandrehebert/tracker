import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FriendsConfigClient } from '~/components/tracker/friends/FriendsConfigClient';
import type { FriendsTrackerConfig } from '~/lib/friendsTracker';
import type { TrackerCronDashboard } from '~/lib/server/trackerCron';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('~/i18n/navigation', () => ({
  Link: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const initialConfig: FriendsTrackerConfig = {
  updatedAt: null,
  updatedBy: null,
  cronEnabled: true,
  currentTripId: 'trip-1',
  friends: [],
  trips: [
    {
      id: 'trip-1',
      name: 'Lisbon',
      destinationAirport: 'LIS',
      friends: [
        {
          id: 'friend-1',
          name: 'Alice',
          flights: [
            {
              id: 'leg-1',
              flightNumber: 'AF123',
              departureTime: '2026-04-14T09:30:00.000Z',
              from: 'CDG',
              to: 'AMS',
            },
            {
              id: 'leg-2',
              flightNumber: 'KL641',
              departureTime: '2026-04-14T13:15:00.000Z',
              from: 'AMS',
              to: 'LIS',
            },
          ],
        },
      ],
    },
  ],
};

const initialCronDashboard: TrackerCronDashboard = {
  mongoConfigured: false,
  config: {
    enabled: true,
    identifiers: ['AF123', 'KL641'],
    manualIdentifiers: ['AF123', 'KL641'],
    chantalIdentifiers: [],
    schedule: '*/15 * * * *',
    updatedAt: null,
    updatedBy: null,
  },
  history: [],
  openSkyToken: {
    providerConfigured: false,
    mongoConfigured: false,
    hasToken: false,
    cacheSource: 'none',
    storageSource: null,
    tokenPreview: null,
    accessToken: null,
    fetchedAt: null,
    expiresAt: null,
    expiresInMs: null,
    isExpired: false,
  },
};

const airportDirectoryResponse = {
  fetchedAt: Date.now(),
  total: 3,
  mapped: 0,
  airports: [
    {
      code: 'CDG',
      iata: 'CDG',
      icao: 'LFPG',
      name: 'Charles de Gaulle Airport',
      city: 'Paris',
      country: 'France',
      latitude: 49.0097,
      longitude: 2.5479,
      timezone: 'Europe/Paris',
      x: null,
      y: null,
    },
    {
      code: 'AMS',
      iata: 'AMS',
      icao: 'EHAM',
      name: 'Amsterdam Airport Schiphol',
      city: 'Amsterdam',
      country: 'Netherlands',
      latitude: 52.3105,
      longitude: 4.7683,
      timezone: 'Europe/Amsterdam',
      x: null,
      y: null,
    },
    {
      code: 'JFK',
      iata: 'JFK',
      icao: 'KJFK',
      name: 'John F. Kennedy International Airport',
      city: 'New York',
      country: 'United States',
      latitude: 40.6413,
      longitude: -73.7781,
      timezone: 'America/New_York',
      x: null,
      y: null,
    },
  ],
};

describe('FriendsConfigClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/airports')) {
        return new Response(JSON.stringify(airportDirectoryResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/chantal/config') && init?.method === 'PUT') {
        const body = typeof init.body === 'string' ? init.body : JSON.stringify(initialConfig);
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(initialConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  it('lets a friend flight leg move down in the itinerary order', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    await user.click(aliceQueries.getByRole('button', { name: /move leg 1 down/i }));

    const flightNumberInputs = aliceQueries.getAllByLabelText(/flight number/i) as HTMLInputElement[];
    expect(flightNumberInputs.map((input) => input.value)).toEqual(['KL641', 'AF123']);
  });

  it('suggests airports for leg from and to fields and stores the selected code', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    const [fromInput] = aliceQueries.getAllByLabelText(/from/i) as HTMLInputElement[];
    await user.clear(fromInput);
    await user.type(fromInput, 'par');

    const fromSuggestion = await screen.findByRole('option', { name: /cdg — charles de gaulle airport/i });
    await user.click(fromSuggestion);
    expect(fromInput).toHaveValue('CDG');

    const toInputs = aliceQueries.getAllByLabelText(/to/i) as HTMLInputElement[];
    const toInput = toInputs[toInputs.length - 1]!;
    await user.clear(toInput);
    await user.type(toInput, 'amst');

    const toSuggestion = await screen.findByRole('option', { name: /ams — amsterdam airport schiphol/i });
    await user.click(toSuggestion);
    expect(toInput).toHaveValue('AMS');
  });

  it('enables save only when there are pending changes', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const saveButton = screen.getByRole('button', { name: /save config/i });
    expect(saveButton).toBeDisabled();

    await user.clear(screen.getByDisplayValue('Lisbon'));
    await user.type(screen.getByPlaceholderText('Weekend in Lisbon'), 'Lisbon crew');

    expect(screen.getByRole('button', { name: /save config/i })).toBeEnabled();
  });

  it('enables save when editing the built-in demo trip', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const saveButton = screen.getByRole('button', { name: /save config/i });
    expect(saveButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /demo \/ test trip/i }));
    await user.clear(screen.getByDisplayValue('Demo / Test Trip'));
    await user.type(screen.getByPlaceholderText('Weekend in Lisbon'), 'Demo / Test Trip custom');

    expect(screen.getByRole('button', { name: /save config/i })).toBeEnabled();
  });

  it('renders the departure field in the departure airport timezone', async () => {
    const baseTrip = initialConfig.trips?.[0];
    const baseFriend = baseTrip?.friends[0];

    const timezoneConfig: FriendsTrackerConfig = {
      ...initialConfig,
      trips: [
        {
          ...baseTrip!,
          friends: [
            {
              ...baseFriend!,
              flights: [
                {
                  id: 'leg-timezone',
                  flightNumber: 'DL100',
                  departureTime: '2026-04-14T09:30:00.000Z',
                  from: 'JFK',
                  to: 'AMS',
                },
              ],
            },
          ],
        },
      ],
    };

    render(<FriendsConfigClient initialConfig={timezoneConfig} initialCronDashboard={initialCronDashboard} />);

    const departureInput = screen.getByLabelText(/estimated departure/i) as HTMLInputElement;

    await waitFor(() => {
      expect(departureInput.value).toBe('2026-04-14T05:30');
    });

    expect(screen.getByText(/Uses America\/New_York for JFK\./i)).toBeInTheDocument();
  });
});
