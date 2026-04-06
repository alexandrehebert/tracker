import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrackerCronAdminClient } from '~/components/tracker/cron/TrackerCronAdminClient';
import type { TrackerCronDashboard, TrackerCronRun } from '~/lib/server/trackerCron';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

function createRun(index: number): TrackerCronRun {
  const startedAt = Date.UTC(2026, 3, index, 12, 0, 0);

  return {
    id: `run-${index}`,
    trigger: 'manual-admin',
    requestedBy: 'test',
    status: 'success',
    startedAt,
    finishedAt: startedAt + 5_000,
    durationMs: 5_000,
    identifiers: [`FLT-${index}`],
    results: [
      {
        identifier: `FLT-${index}`,
        status: 'matched',
        fetchedAt: startedAt + 2_000,
        matchedIdentifiers: [`FLT-${index}`],
        notFoundIdentifiers: [],
        flightCount: 1,
        cachedIcao24s: [`icao-${index}`],
        error: null,
      },
    ],
    summary: {
      totalIdentifiers: 1,
      matchedIdentifiers: 1,
      notFoundIdentifiers: 0,
      errors: 0,
      flightsFetched: 1,
    },
    error: null,
  };
}

const initialDashboard = {
  mongoConfigured: true,
  config: {
    enabled: true,
    identifiers: ['AF123', 'TEST1', 'TEST2'],
    manualIdentifiers: ['AF123'],
    chantalIdentifiers: ['TEST1', 'TEST2'],
    schedule: '*/15 * * * *',
    updatedAt: null,
    updatedBy: null,
  },
  history: Array.from({ length: 12 }, (_, index) => createRun(index + 1)),
  openSkyToken: {
    providerConfigured: false,
    mongoConfigured: true,
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
} as TrackerCronDashboard;

describe('TrackerCronAdminClient', () => {
  it('shows Chantal-managed flights separately from the editable manual list', () => {
    render(<TrackerCronAdminClient initialDashboard={initialDashboard} />);

    expect(screen.getByLabelText(/manual flight identifiers/i)).toHaveValue('AF123');
    expect(screen.getByText(/managed by \/chantal/i)).toBeInTheDocument();

    const chantalTextarea = screen.getByLabelText(/chantal-managed flight identifiers/i);
    expect(chantalTextarea).toHaveValue('TEST1\nTEST2');
    expect(chantalTextarea).toHaveAttribute('readonly');
  });

  it('shows execution history in batches of 10 and lets the user load more', async () => {
    const user = userEvent.setup();
    const { container } = render(<TrackerCronAdminClient initialDashboard={initialDashboard} />);

    expect(container.querySelectorAll('details')).toHaveLength(10);
    expect(screen.getByRole('button', { name: /load 10 more/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /load 10 more/i }));

    expect(container.querySelectorAll('details')).toHaveLength(12);
  });
});
