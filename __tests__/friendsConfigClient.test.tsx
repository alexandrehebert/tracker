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
  total: 4,
  mapped: 0,
  airports: [
    {
      code: 'SJC',
      iata: 'SJC',
      icao: 'KSJC',
      name: 'San Jose Mineta International Airport',
      city: 'San Jose',
      country: 'United States',
      latitude: 37.3639,
      longitude: -121.9289,
      timezone: 'America/Los_Angeles',
      x: null,
      y: null,
    },
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

function buildAirportFixtureTimezoneLookup(airports: typeof airportDirectoryResponse.airports): Record<string, string> {
  return airports.reduce<Record<string, string>>((lookup, airport) => {
    if (!airport.timezone) {
      return lookup;
    }

    for (const code of [airport.code, airport.iata, airport.icao]) {
      if (code) {
        lookup[code] = airport.timezone;
      }
    }

    return lookup;
  }, {});
}

function buildAirportFixtureSearchValue(airport: typeof airportDirectoryResponse.airports[number]): string {
  return [airport.code, airport.iata, airport.icao, airport.name, airport.city, airport.country, airport.timezone]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function getAirportFixtureScore(airport: typeof airportDirectoryResponse.airports[number], query: string): number {
  const normalizedSearch = query.toLowerCase();
  const normalizedCode = query.toUpperCase();
  const codes = [airport.code, airport.iata, airport.icao].filter(Boolean) as string[];
  const textFields = [airport.name, airport.city, airport.country, airport.timezone]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  let score = 0;

  if (codes.some((code) => code === normalizedCode)) score += 1000;
  if (codes.some((code) => code.startsWith(normalizedCode))) score += 700;
  if (textFields.some((field) => field === normalizedSearch)) score += 450;
  if (textFields.some((field) => field.startsWith(normalizedSearch))) score += 300;
  if (textFields.some((field) => field.split(/[\s,/()-]+/).some((word) => word.startsWith(normalizedSearch)))) score += 180;
  if (textFields.some((field) => field.includes(normalizedSearch))) score += 90;

  return score;
}

function searchAirportFixture(query: string): typeof airportDirectoryResponse.airports {
  const normalizedSearch = query.trim().toLowerCase();

  return [...airportDirectoryResponse.airports]
    .filter((airport) => buildAirportFixtureSearchValue(airport).includes(normalizedSearch))
    .sort((left, right) => getAirportFixtureScore(right, query) - getAirportFixtureScore(left, query));
}

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
        const parsedUrl = new URL(url, 'http://localhost');
        const query = parsedUrl.searchParams.get('query')?.trim() ?? '';
        const codesParam = parsedUrl.searchParams.get('codes')?.trim() ?? '';

        const airports = codesParam
          ? airportDirectoryResponse.airports.filter((airport) => codesParam.split(',').map((code) => code.trim().toUpperCase()).includes(airport.code))
          : query
            ? searchAirportFixture(query)
            : airportDirectoryResponse.airports;

        return new Response(JSON.stringify({
          ...airportDirectoryResponse,
          total: airports.length,
          airports,
          timezones: buildAirportFixtureTimezoneLookup(airports),
        }), {
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

    const arrivalListbox = await screen.findByRole('listbox', { name: /arrival airport suggestions for leg 2/i });
    const toSuggestion = within(arrivalListbox).getByRole('option', { name: /ams — amsterdam airport schiphol/i });
    await user.click(toSuggestion);
    expect(toInput).toHaveValue('AMS');
  });

  it('orders airport suggestions by relevance instead of raw directory order', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    const [fromInput] = aliceQueries.getAllByLabelText(/from/i) as HTMLInputElement[];
    await user.clear(fromInput);
    await user.type(fromInput, 'jo');

    const listbox = await screen.findByRole('listbox', { name: /departure airport suggestions for leg 1/i });
    const options = within(listbox).getAllByRole('option');

    expect(options[0]).toHaveTextContent('JFK — John F. Kennedy International Airport');
  });

  it('keeps the dropdown open for a unique exact airport code match so the name stays visible', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    const [fromInput] = aliceQueries.getAllByLabelText(/from/i) as HTMLInputElement[];
    await user.clear(fromInput);
    await user.type(fromInput, 'jfk');

    const listbox = await screen.findByRole('listbox', { name: /departure airport suggestions for leg 1/i });
    expect(within(listbox).getByRole('option', { name: /jfk — john f\. kennedy international airport/i })).toBeVisible();
    expect(fromInput).toHaveValue('JFK');
  });

  it('hides the airport dropdown once the input loses focus', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    const [fromInput] = aliceQueries.getAllByLabelText(/from/i) as HTMLInputElement[];
    await user.clear(fromInput);
    await user.type(fromInput, 'par');

    await screen.findByRole('listbox', { name: /departure airport suggestions for leg 1/i });
    await user.click(aliceQueries.getByDisplayValue('Alice'));

    expect(screen.queryByRole('listbox', { name: /departure airport suggestions for leg 1/i })).not.toBeInTheDocument();
  });

  it('marks the current airport value as selected and closes when clicking it', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    const [fromInput] = aliceQueries.getAllByLabelText(/from/i) as HTMLInputElement[];

    await user.click(fromInput);
    const listbox = await screen.findByRole('listbox', { name: /departure airport suggestions for leg 1/i });
    const selectedOption = within(listbox).getByRole('option', { name: /cdg — charles de gaulle airport/i });

    expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    expect(selectedOption).toHaveClass('bg-cyan-500/15');

    await user.click(selectedOption);
    expect(screen.queryByRole('listbox', { name: /departure airport suggestions for leg 1/i })).not.toBeInTheDocument();
  });

  it('creates and selects a new imported trip when payload does not match an existing trip id', async () => {
    const user = userEvent.setup();
    const { container } = render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    const importPayload = {
      updatedAt: 1_775_520_843_900,
      updatedBy: 'chantal config page',
      destinationAirport: 'SIN',
      friends: [
        {
          name: 'Dul',
          avatarUrl: null,
          flights: [
            {
              flightNumber: 'MU554',
              departureTime: '2026-04-14T11:25:00.000Z',
              departureTimezone: 'Europe/Paris',
              from: 'CDG',
              to: 'PVG',
              note: 'Connection in Shanghai',
              resolvedIcao24: null,
              lastResolvedAt: null,
            },
            {
              flightNumber: 'MU567',
              departureTime: '2026-04-15T02:10:00.000Z',
              departureTimezone: 'Asia/Shanghai',
              from: 'PVG',
              to: 'SIN',
              note: null,
              resolvedIcao24: null,
              lastResolvedAt: null,
            },
          ],
        },
      ],
    } as Partial<FriendsTrackerConfig>;

    await user.upload(fileInput as HTMLInputElement, new File([
      JSON.stringify(importPayload),
    ], 'import.json', { type: 'application/json' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Imported trip')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Dul')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /lisbon/i })).toBeInTheDocument();

    const dulCard = screen.getByDisplayValue('Dul').closest('section');
    expect(dulCard).not.toBeNull();

    const dulQueries = within(dulCard as HTMLElement);
    const flightNumberInputs = dulQueries.getAllByLabelText(/flight number/i) as HTMLInputElement[];

    expect(flightNumberInputs.map((input) => input.value)).toEqual(['MU554', 'MU567']);
    expect(screen.getByRole('button', { name: /save config/i })).toBeEnabled();
  });

  it('validates a configured leg on demand and surfaces live provider details', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(window.fetch);
    const matchedDepartureSeconds = Math.floor(Date.parse('2026-04-14T09:35:00.000Z') / 1000);
    const matchedArrivalSeconds = Math.floor(Date.parse('2026-04-14T11:10:00.000Z') / 1000);

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/airports')) {
        const parsedUrl = new URL(url, 'http://localhost');
        const query = parsedUrl.searchParams.get('query')?.trim() ?? '';
        const codesParam = parsedUrl.searchParams.get('codes')?.trim() ?? '';

        const airports = codesParam
          ? airportDirectoryResponse.airports.filter((airport) => codesParam.split(',').map((code) => code.trim().toUpperCase()).includes(airport.code))
          : query
            ? searchAirportFixture(query)
            : airportDirectoryResponse.airports;

        return new Response(JSON.stringify({
          ...airportDirectoryResponse,
          total: airports.length,
          airports,
          timezones: buildAirportFixtureTimezoneLookup(airports),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/chantal/validate-flight')) {
        return new Response(JSON.stringify({
          status: 'matched',
          message: 'FlightAware matched AF123. Departure is +5 min vs the configured schedule. ICAO24 3C675A is available.',
          providerLabel: 'FlightAware',
          matchedIcao24: '3C675A',
          matchedFlightNumber: 'AF123',
          matchedDepartureTime: matchedDepartureSeconds * 1000,
          matchedArrivalTime: matchedArrivalSeconds * 1000,
          departureDeltaMinutes: 5,
          matchedRoute: 'CDG → AMS',
          lastCheckedAt: Date.now(),
        }), {
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

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    await user.click(aliceQueries.getByRole('button', { name: /validate flight for leg 1/i }));

    expect(await screen.findByText(/Schedule match confirmed/i)).toBeInTheDocument();
    expect((await screen.findAllByText(/3C675A/i)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Arrival:/i)).toBeInTheDocument();
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

  it('persists the selected current trip immediately when publishing it live', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(window.fetch);
    const multiTripConfig: FriendsTrackerConfig = {
      ...initialConfig,
      currentTripId: 'trip-1',
      trips: [
        ...(initialConfig.trips ?? []),
        {
          id: 'trip-2',
          name: 'Tokyo',
          destinationAirport: 'HND',
          friends: [],
        },
      ],
    };

    render(<FriendsConfigClient initialConfig={multiTripConfig} initialCronDashboard={initialCronDashboard} />);

    await user.click(screen.getByRole('button', { name: /tokyo/i }));
    await user.click(screen.getByRole('button', { name: /set as current trip/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chantal/config', expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"currentTripId":"trip-2"'),
      }));
      expect(screen.getByRole('button', { name: /save config/i })).toBeDisabled();
    });

    expect(await screen.findByText('Live `/chantal` trip updated and saved immediately.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /current on \/chantal/i })).toBeInTheDocument();
  });

  it('renders the departure field in the persisted departure timezone', async () => {
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
                  departureTimezone: 'America/New_York',
                },
              ],
            },
          ],
        },
      ],
    };

    render(
      <FriendsConfigClient
        initialConfig={timezoneConfig}
        initialCronDashboard={initialCronDashboard}
      />,
    );

    const departureInput = screen.getByLabelText(/estimated departure/i) as HTMLInputElement;

    expect(departureInput.value).toBe('2026-04-14T05:30');
    expect(screen.getByText(/Uses America\/New_York for JFK\./i)).toBeInTheDocument();

    await waitFor(() => {
      expect(departureInput.value).toBe('2026-04-14T05:30');
    });
  });
});
