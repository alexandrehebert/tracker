import { render, screen, within } from '@testing-library/react';
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

describe('FriendsConfigClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(initialConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
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
});
