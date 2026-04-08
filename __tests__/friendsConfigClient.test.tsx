import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('opens Flightradar24 from the flight number field shortcut', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    await user.click(aliceQueries.getByRole('button', { name: /open af123 on flightradar24/i }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://www.flightradar24.com/AF123',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('uses an avatar accent dot picker with a reset-to-auto action', async () => {
    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    expect(aliceQueries.getByRole('button', { name: /choose accent color for alice/i })).toBeInTheDocument();
    expect(aliceQueries.queryByRole('button', { name: /use automatic accent color for alice/i })).not.toBeInTheDocument();

    const colorInput = aliceQueries.getByLabelText(/accent color for alice/i, { selector: 'input' });
    fireEvent.change(colorInput, { target: { value: '#ff00ff' } });

    await waitFor(() => {
      expect(aliceQueries.getByRole('button', { name: /use automatic accent color for alice/i })).toBeInTheDocument();
    });

    fireEvent.click(aliceQueries.getByRole('button', { name: /use automatic accent color for alice/i }));

    await waitFor(() => {
      expect(aliceQueries.queryByRole('button', { name: /use automatic accent color for alice/i })).not.toBeInTheDocument();
    });
  });

  it('keeps a new friend auto color stable when the name changes', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    await user.click(screen.getByRole('button', { name: /add friend/i }));

    const newFriendCard = screen.getByPlaceholderText('Friend 2').closest('section');
    expect(newFriendCard).not.toBeNull();

    const newFriendQueries = within(newFriendCard as HTMLElement);
    const initialAutoColor = (newFriendQueries.getByLabelText(/accent color for friend 2/i, { selector: 'input' }) as HTMLInputElement).value;

    const nameInput = newFriendQueries.getByPlaceholderText('Friend 2');
    await user.type(nameInput, 'Zoey');

    await waitFor(() => {
      const renamedColorInput = newFriendQueries.getByLabelText(/accent color for zoey/i, { selector: 'input' }) as HTMLInputElement;
      expect(renamedColorInput.value).toBe(initialAutoColor);
      expect(newFriendQueries.queryByRole('button', { name: /use automatic accent color for zoey/i })).not.toBeInTheDocument();
    });
  });

  it('hides the current airport field when a friend already has flight legs', () => {
    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    expect(screen.queryByLabelText(/current airport for alice/i)).not.toBeInTheDocument();
  });

  it('lets you save a non-traveler friend with just a current airport and no flights', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, 'fetch');

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    await user.click(screen.getByRole('button', { name: /add friend/i }));

    const newFriendCard = screen.getByPlaceholderText('Friend 2').closest('section');
    expect(newFriendCard).not.toBeNull();

    const newFriendQueries = within(newFriendCard as HTMLElement);
    await user.type(newFriendQueries.getByPlaceholderText('Friend 2'), 'Maya');
    await user.clear(newFriendQueries.getByLabelText(/current airport for maya/i));
    await user.type(newFriendQueries.getByLabelText(/current airport for maya/i), 'jfk');

    const listbox = await screen.findByRole('listbox', { name: /current airport suggestions for maya/i });
    await user.click(within(listbox).getByRole('option', { name: /jfk — john f\. kennedy international airport/i }));

    expect(newFriendQueries.queryByText(/leg 1/i)).not.toBeInTheDocument();
    expect(newFriendQueries.getByLabelText(/current airport for maya/i)).toHaveValue('JFK');

    await user.click(screen.getByRole('button', { name: /save config/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chantal/config', expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"currentAirport":"JFK"'),
      }));
    });

    const saveRequest = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/chantal/config'
      && init?.method === 'PUT'
      && typeof init.body === 'string'
      && init.body.includes('"Maya"')
    ));

    expect(saveRequest).toBeDefined();
    expect(typeof saveRequest?.[1]?.body).toBe('string');
    expect(saveRequest?.[1]?.body as string).toContain('"currentAirport":"JFK"');
    expect(saveRequest?.[1]?.body as string).toContain('"flights":[]');
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

  it('exports JSON without the built-in demo trip', async () => {
    const user = userEvent.setup();
    const exportConfig: FriendsTrackerConfig = {
      ...initialConfig,
      currentTripId: 'demo-test-trip',
      trips: [
        ...(initialConfig.trips ?? []),
        {
          id: 'demo-test-trip',
          name: 'Demo / Test Trip',
          destinationAirport: 'JFK',
          isDemo: true,
          friends: [
            {
              id: 'demo-friend',
              name: 'Demo Friend',
              flights: [
                {
                  id: 'demo-leg',
                  flightNumber: 'TEST1',
                  departureTime: '2026-04-14T09:30:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };

    let capturedBlob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return 'blob:chantal-export';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<FriendsConfigClient initialConfig={exportConfig} initialCronDashboard={initialCronDashboard} />);

    await user.click(screen.getByRole('button', { name: /export/i }));

    expect(capturedBlob).not.toBeNull();
    const exported = JSON.parse(await capturedBlob!.text()) as FriendsTrackerConfig;

    expect((exported.trips ?? []).some((trip) => trip.isDemo)).toBe(false);
    expect(exported.currentTripId).toBe('trip-1');
  });

  it('ignores demo-only trips when importing JSON', async () => {
    const user = userEvent.setup();
    const { container } = render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    const importPayload = {
      updatedAt: 1_775_520_843_900,
      updatedBy: 'chantal config page',
      currentTripId: 'demo-test-trip',
      trips: [
        {
          id: 'demo-test-trip',
          name: 'Injected Demo Trip',
          destinationAirport: 'JFK',
          isDemo: true,
          friends: [
            {
              name: 'Demo only',
              flights: [
                {
                  flightNumber: 'TEST1',
                  departureTime: '2026-04-14T11:25:00.000Z',
                  from: 'CDG',
                  to: 'JFK',
                },
              ],
            },
          ],
        },
      ],
    } as Partial<FriendsTrackerConfig>;

    await user.upload(fileInput as HTMLInputElement, new File([
      JSON.stringify(importPayload),
    ], 'import.json', { type: 'application/json' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /injected demo trip/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /lisbon/i })).toBeInTheDocument();
    });
  });

  it('counts flights without an applied validation as unresolved in the save bar', () => {
    const configWithPartialValidation: FriendsTrackerConfig = {
      ...initialConfig,
      trips: [
        {
          ...initialConfig.trips![0]!,
          friends: [
            {
              ...initialConfig.trips![0]!.friends[0]!,
              flights: [
                {
                  ...initialConfig.trips![0]!.friends[0]!.flights[0]!,
                  validatedFlight: {
                    status: 'matched',
                    providerLabel: 'FlightAware',
                    message: 'FlightAware confirmed the schedule.',
                    matchedIcao24: '3C675A',
                    matchedFlightNumber: 'AF123',
                    matchedDepartureTime: '2026-04-14T09:30:00.000Z',
                    matchedArrivalTime: '2026-04-14T11:10:00.000Z',
                    matchedDepartureAirport: 'CDG',
                    matchedArrivalAirport: 'AMS',
                    matchedRoute: 'CDG → AMS',
                    departureDeltaMinutes: 0,
                    lastCheckedAt: 1_775_520_843_900,
                  },
                },
                {
                  ...initialConfig.trips![0]!.friends[0]!.flights[1]!,
                  validatedFlight: null,
                },
              ],
            },
          ],
        },
      ],
    };

    render(<FriendsConfigClient initialConfig={configWithPartialValidation} initialCronDashboard={initialCronDashboard} />);

    expect(screen.getByText(/1 matched • 0 warnings • 1 unresolved/i)).toBeInTheDocument();
  });

  it('opens the validation modal first so providers can be chosen before running validation', async () => {
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
          matchedDepartureAirport: 'CDG',
          matchedArrivalAirport: 'AMS',
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

    expect(await screen.findByText(/Select provider/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/chantal/validate-flight', expect.anything());

    await user.click(screen.getByRole('button', { name: /run validation/i }));

    expect(await screen.findByText(/Schedule match confirmed/i)).toBeInTheDocument();
    expect((await screen.findAllByText(/3C675A/i)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Arrival:/i)).toBeInTheDocument();
  });

  it('updates the leg departure time and preserves warning status after reload', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(window.fetch);
    const matchedDepartureMs = Date.parse('2026-04-15T10:45:00.000Z');
    const matchedArrivalMs = Date.parse('2026-04-15T13:05:00.000Z');
    let savedConfigBody: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/airports')) {
        return new Response(JSON.stringify({
          ...airportDirectoryResponse,
          timezones: buildAirportFixtureTimezoneLookup(airportDirectoryResponse.airports),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/chantal/validate-flight')) {
        return new Response(JSON.stringify({
          status: 'warning',
          message: 'FlightAware matched the flight but on the following day.',
          providerLabel: 'FlightAware',
          matchedIcao24: 'A1B2C3',
          matchedFlightNumber: 'AF456',
          matchedDepartureTime: matchedDepartureMs,
          matchedArrivalTime: matchedArrivalMs,
          matchedDepartureAirport: 'JFK',
          matchedArrivalAirport: 'LIS',
          departureDeltaMinutes: 1515,
          matchedRoute: 'JFK → LIS',
          lastCheckedAt: Date.now(),
          candidates: [
            {
              status: 'warning',
              providerLabel: 'FlightAware',
              matchedIcao24: 'A1B2C3',
              matchedFlightNumber: 'AF456',
              matchedDepartureTime: matchedDepartureMs,
              matchedArrivalTime: matchedArrivalMs,
              matchedDepartureAirport: 'JFK',
              matchedArrivalAirport: 'LIS',
              departureDeltaMinutes: 1515,
              matchedRoute: 'JFK → LIS',
              message: 'This schedule is on the next service day.',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/chantal/config') && init?.method === 'PUT') {
        savedConfigBody = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>;
        return new Response(JSON.stringify(savedConfigBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(initialConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const singleLegConfig: FriendsTrackerConfig = {
      ...initialConfig,
      trips: [
        {
          ...initialConfig.trips![0]!,
          friends: [
            {
              ...initialConfig.trips![0]!.friends[0]!,
              flights: [initialConfig.trips![0]!.friends[0]!.flights[0]!],
            },
          ],
        },
      ],
    };

    const { rerender } = render(
      <FriendsConfigClient
        initialConfig={singleLegConfig}
        initialCronDashboard={initialCronDashboard}
        initialAirportTimezones={{ CDG: 'UTC', AMS: 'UTC', JFK: 'UTC', LIS: 'UTC' }}
      />,
    );

    const aliceCard = screen.getByDisplayValue('Alice').closest('section');
    expect(aliceCard).not.toBeNull();

    const aliceQueries = within(aliceCard as HTMLElement);
    await user.click(aliceQueries.getByRole('button', { name: /validate flight for leg 1/i }));
    await user.click(await screen.findByRole('button', { name: /run validation/i }));
    await user.click(await screen.findByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(aliceQueries.getByLabelText(/flight number for leg 1/i)).toHaveValue('AF456');
      expect(aliceQueries.getByLabelText(/estimated departure for leg 1/i)).toHaveValue('2026-04-15T06:45');
    });

    expect(await screen.findByText(/Provider match needs review/i)).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /save config/i });
    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });
    await user.click(saveButton);

    await waitFor(() => {
      const savedTrips = savedConfigBody?.trips;
      expect(Array.isArray(savedTrips)).toBe(true);
      const savedLeg = (savedTrips as Array<{ friends: Array<{ flights: Array<Record<string, unknown>> }> }>)[0]?.friends[0]?.flights[0];
      expect(savedLeg).toMatchObject({
        flightNumber: 'AF456',
        departureTime: '2026-04-15T10:45:00.000Z',
        resolvedIcao24: 'A1B2C3',
        validatedFlight: expect.objectContaining({
          status: 'warning',
          matchedDepartureTime: '2026-04-15T10:45:00.000Z',
        }),
      });
    });

    rerender(
      <FriendsConfigClient
        initialConfig={savedConfigBody as unknown as FriendsTrackerConfig}
        initialCronDashboard={initialCronDashboard}
        initialAirportTimezones={{ CDG: 'UTC', AMS: 'UTC', JFK: 'UTC', LIS: 'UTC' }}
      />,
    );

    expect(await screen.findByText(/Provider match needs review/i)).toBeInTheDocument();
  });

  it('applies the selected validation match onto the leg and save payload', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(window.fetch);
    const matchedDepartureMs = Date.parse('2026-04-14T11:45:00.000Z');
    const matchedArrivalMs = Date.parse('2026-04-14T13:05:00.000Z');
    let savedConfigBody: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.includes('/api/airports')) {
        return new Response(JSON.stringify({
          ...airportDirectoryResponse,
          timezones: buildAirportFixtureTimezoneLookup(airportDirectoryResponse.airports),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/chantal/validate-flight')) {
        return new Response(JSON.stringify({
          status: 'matched',
          message: 'FlightAware matched the updated schedule.',
          providerLabel: 'FlightAware',
          matchedIcao24: 'A1B2C3',
          matchedFlightNumber: 'AF456',
          matchedDepartureTime: matchedDepartureMs,
          matchedArrivalTime: matchedArrivalMs,
          departureDeltaMinutes: 135,
          matchedRoute: 'JFK → LIS',
          lastCheckedAt: Date.now(),
          candidates: [
            {
              status: 'matched',
              providerLabel: 'FlightAware',
              matchedIcao24: 'A1B2C3',
              matchedFlightNumber: 'AF456',
              matchedDepartureTime: matchedDepartureMs,
              matchedArrivalTime: matchedArrivalMs,
              matchedDepartureAirport: 'JFK',
              matchedArrivalAirport: 'LIS',
              departureDeltaMinutes: 135,
              matchedRoute: 'JFK → LIS',
              message: 'Best match based on route and schedule.',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/chantal/config') && init?.method === 'PUT') {
        savedConfigBody = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>;
        return new Response(JSON.stringify(savedConfigBody), {
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
    await user.click(await screen.findByRole('button', { name: /run validation/i }));
    await user.click(await screen.findByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(aliceQueries.getByLabelText(/flight number for leg 1/i)).toHaveValue('AF456');
      expect(aliceQueries.getByLabelText(/from airport for leg 1/i)).toHaveValue('JFK');
      expect(aliceQueries.getByLabelText(/to airport for leg 1/i)).toHaveValue('LIS');
    });

    expect(await screen.findByText(/Locked ICAO24: A1B2C3/i)).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /save config/i });
    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });
    await user.click(saveButton);

    await waitFor(() => {
      const savedTrips = savedConfigBody?.trips;
      expect(Array.isArray(savedTrips)).toBe(true);
      const savedLeg = (savedTrips as Array<{ friends: Array<{ flights: Array<Record<string, unknown>> }> }>)[0]?.friends[0]?.flights[0];
      expect(savedLeg).toMatchObject({
        flightNumber: 'AF456',
        departureTime: '2026-04-14T11:45:00.000Z',
        arrivalTime: '2026-04-14T13:05:00.000Z',
        from: 'JFK',
        to: 'LIS',
        resolvedIcao24: 'A1B2C3',
      });
    });
  });

  it('restores the applied validation modal summary and green leg state after refresh', async () => {
    const user = userEvent.setup();
    const persistedConfig: FriendsTrackerConfig = {
      ...initialConfig,
      trips: [
        {
          ...initialConfig.trips![0]!,
          friends: [
            {
              ...initialConfig.trips![0]!.friends[0]!,
              flights: [
                {
                  ...initialConfig.trips![0]!.friends[0]!.flights[0]!,
                  flightNumber: 'AF456',
                  from: 'JFK',
                  to: 'LIS',
                  resolvedIcao24: 'A1B2C3',
                  lastResolvedAt: 1_775_520_843_900,
                  validatedFlight: {
                    status: 'matched',
                    providerLabel: 'FlightAware',
                    message: 'Applied and saved.',
                    matchedIcao24: 'A1B2C3',
                    matchedFlightNumber: 'AF456',
                    matchedDepartureTime: '2026-04-14T11:45:00.000Z',
                    matchedArrivalTime: '2026-04-14T13:05:00.000Z',
                    matchedDepartureAirport: 'JFK',
                    matchedArrivalAirport: 'LIS',
                    matchedRoute: 'JFK → LIS',
                    departureDeltaMinutes: 135,
                    lastCheckedAt: 1_775_520_843_900,
                  },
                },
                ...initialConfig.trips![0]!.friends[0]!.flights.slice(1),
              ],
            },
          ],
        },
      ],
    };

    render(<FriendsConfigClient initialConfig={persistedConfig} initialCronDashboard={initialCronDashboard} />);

    const validatedButton = screen.getByRole('button', { name: /validated flight for leg 1/i });
    expect(validatedButton).toBeInTheDocument();

    const validatedLeg = validatedButton.closest('div[class*="rounded-2xl"]');
    expect(validatedLeg?.className).toContain('border-emerald-400/35');

    await user.click(validatedButton);

    expect(await screen.findByText(/Current leg status/i)).toBeInTheDocument();
    expect(screen.getByText(/Schedule match confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/Source: FlightAware/i)).toBeInTheDocument();
  });

  it('marks single-flight validation as on-demand so premium providers stay click-only', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(window.fetch);

    fetchMock.mockImplementation(async (input, init) => {
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

      if (url.includes('/api/chantal/validate-flight')) {
        return new Response(JSON.stringify({
          status: 'matched',
          message: 'AeroDataBox matched AF123. Departure is +5 min vs the configured schedule. ICAO24 3C675A is available.',
          providerLabel: 'AeroDataBox',
          matchedIcao24: '3C675A',
          matchedFlightNumber: 'AF123',
          matchedDepartureTime: Date.parse('2026-04-14T09:35:00.000Z'),
          matchedArrivalTime: Date.parse('2026-04-14T11:10:00.000Z'),
          departureDeltaMinutes: 5,
          matchedRoute: 'CDG → AMS',
          lastCheckedAt: Date.now(),
        }), {
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

    await user.click(within(aliceCard as HTMLElement).getByRole('button', { name: /validate flight for leg 1/i }));
    await user.click(await screen.findByRole('button', { name: /run validation/i }));

    await screen.findByText(/Schedule match confirmed/i);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chantal/validate-flight', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"includeOnDemandProviders":true'),
      }));
    });
  });

  it('keeps the save bar above group trips and highlights it when there are pending changes', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const saveButton = screen.getByRole('button', { name: /save config/i });
    const saveBar = saveButton.closest('section');
    const groupTripsHeading = screen.getByText(/group trips/i);

    expect(saveButton).toBeDisabled();
    expect(saveBar).not.toBeNull();
    if (!saveBar) {
      throw new Error('Expected the save bar section to be rendered.');
    }
    expect(saveBar).toHaveClass('border-white/10');
    expect(Boolean(saveBar.compareDocumentPosition(groupTripsHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    await user.clear(screen.getByDisplayValue('Lisbon'));
    await user.type(screen.getByPlaceholderText('Weekend in Lisbon'), 'Lisbon crew');

    expect(screen.getByRole('button', { name: /save config/i })).toBeEnabled();
    expect(saveBar).toHaveClass('border-slate-700');
  });

  it('reverts pending changes when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(<FriendsConfigClient initialConfig={initialConfig} initialCronDashboard={initialCronDashboard} />);

    const tripNameInput = screen.getByDisplayValue('Lisbon') as HTMLInputElement;
    const saveButton = screen.getByRole('button', { name: /save config/i });

    await user.clear(tripNameInput);
    await user.type(screen.getByPlaceholderText('Weekend in Lisbon'), 'Lisbon crew');

    expect(saveButton).toBeEnabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Lisbon')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Lisbon crew')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save config/i })).toBeDisabled();
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });
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

  it('shows condensed outbound and return itinerary preview chips', () => {
    const routePreviewConfig: FriendsTrackerConfig = {
      ...initialConfig,
      trips: [
        {
          ...initialConfig.trips![0]!,
          destinationAirport: 'SIN',
          friends: [
            {
              ...initialConfig.trips![0]!.friends[0]!,
              flights: [
                {
                  id: 'leg-outbound-1',
                  flightNumber: 'AF010',
                  departureTime: '2026-04-14T09:30:00.000Z',
                  from: 'CDG',
                  to: 'JFK',
                },
                {
                  id: 'leg-outbound-2',
                  flightNumber: 'SQ025',
                  departureTime: '2026-04-15T09:30:00.000Z',
                  from: 'JFK',
                  to: 'SIN',
                },
                {
                  id: 'leg-return-1',
                  flightNumber: 'SQ026',
                  departureTime: '2026-04-20T09:30:00.000Z',
                  from: 'SIN',
                  to: 'JFK',
                },
                {
                  id: 'leg-return-2',
                  flightNumber: 'AF011',
                  departureTime: '2026-04-21T09:30:00.000Z',
                  from: 'JFK',
                  to: 'CDG',
                },
              ],
            },
          ],
        },
      ],
    };

    render(
      <FriendsConfigClient
        initialConfig={routePreviewConfig}
        initialCronDashboard={initialCronDashboard}
      />,
    );

    expect(screen.getByText((_, element) => element?.textContent === 'To destination: CDG → JFK → SIN')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Return: SIN → JFK → CDG')).toBeInTheDocument();
  });

  it('provides a visible date picker button for each departure field', async () => {
    const inputPrototype = HTMLInputElement.prototype as HTMLInputElement & { showPicker?: () => void };
    const originalShowPicker = inputPrototype.showPicker;
    const showPicker = vi.fn();
    const user = userEvent.setup();
    inputPrototype.showPicker = showPicker;

    try {
      render(
        <FriendsConfigClient
          initialConfig={initialConfig}
          initialCronDashboard={initialCronDashboard}
        />, 
      );

      await user.click(screen.getByRole('button', { name: /open date picker for leg 1/i }));
      expect(showPicker).toHaveBeenCalledTimes(1);
    } finally {
      if (originalShowPicker) {
        inputPrototype.showPicker = originalShowPicker;
      } else {
        Reflect.deleteProperty(inputPrototype, 'showPicker');
      }
    }
  });

  it('prepopulates the optional arrival field from saved validation data', async () => {
    const persistedConfig: FriendsTrackerConfig = {
      ...initialConfig,
      trips: [
        {
          ...initialConfig.trips![0]!,
          friends: [
            {
              ...initialConfig.trips![0]!.friends[0]!,
              flights: [
                {
                  ...initialConfig.trips![0]!.friends[0]!.flights[0]!,
                  arrivalTime: null,
                  to: 'LIS',
                  validatedFlight: {
                    status: 'matched',
                    providerLabel: 'FlightAware',
                    message: 'Applied and saved.',
                    matchedIcao24: 'A1B2C3',
                    matchedFlightNumber: 'AF456',
                    matchedDepartureTime: '2026-04-14T11:45:00.000Z',
                    matchedArrivalTime: '2026-04-14T13:05:00.000Z',
                    matchedDepartureAirport: 'JFK',
                    matchedArrivalAirport: 'LIS',
                    matchedRoute: 'JFK → LIS',
                    departureDeltaMinutes: 135,
                    lastCheckedAt: 1_775_520_843_900,
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    render(
      <FriendsConfigClient
        initialConfig={persistedConfig}
        initialCronDashboard={initialCronDashboard}
        initialAirportTimezones={{ JFK: 'UTC', LIS: 'UTC' }}
      />,
    );

    const arrivalInput = await screen.findByLabelText(/estimated arrival for leg 1/i) as HTMLInputElement;
    expect(arrivalInput.value).toBe('2026-04-14T13:05');
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
