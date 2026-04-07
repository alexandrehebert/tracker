import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFriendsTrackerConfigMock = vi.fn();
const getLatestPositionSnapshotMock = vi.fn();
const listPositionSnapshotTimestampsMock = vi.fn();
const lookupAirportDetailsMock = vi.fn();
const getWorldMapPayloadMock = vi.fn();
const isChantalV2TestModeMock = vi.fn();
const getTestLatestSnapshotMock = vi.fn();
const getTestSnapshotTimestampsMock = vi.fn();

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

vi.mock('~/components/tracker/friends/ChantalV2Client', () => ({
  default: function MockChantalV2Client(props: {
    initialConfig: { currentTripId?: string | null };
    initialSnapshot: { tripId?: string | null } | null;
    useDemoSnapshots?: boolean;
  }) {
    return (
      <pre data-testid="chantal-v2-client-props">
        {JSON.stringify({
          currentTripId: props.initialConfig.currentTripId ?? null,
          initialSnapshotTripId: props.initialSnapshot?.tripId ?? null,
          useDemoSnapshots: props.useDemoSnapshots ?? false,
        })}
      </pre>
    );
  },
}));

vi.mock('~/lib/server/friendsTracker', () => ({
  readFriendsTrackerConfig: readFriendsTrackerConfigMock,
}));

vi.mock('~/lib/server/chantalV2Snapshots', () => ({
  getLatestPositionSnapshot: getLatestPositionSnapshotMock,
  listPositionSnapshotTimestamps: listPositionSnapshotTimestampsMock,
}));

vi.mock('~/lib/server/airports', () => ({
  lookupAirportDetails: lookupAirportDetailsMock,
}));

vi.mock('~/lib/server/worldMap', () => ({
  getWorldMapPayload: getWorldMapPayloadMock,
}));

vi.mock('~/lib/server/chantalV2TestMode', () => ({
  isChantalV2TestMode: isChantalV2TestModeMock,
  getTestLatestSnapshot: getTestLatestSnapshotMock,
  getTestSnapshotTimestamps: getTestSnapshotTimestampsMock,
}));

async function loadPageModule() {
  vi.resetModules();
  return await import('~/app/[locale]/chantal/v2/page');
}

describe('Chantal V2 page mode switching', () => {
  beforeEach(() => {
    readFriendsTrackerConfigMock.mockReset();
    getLatestPositionSnapshotMock.mockReset();
    listPositionSnapshotTimestampsMock.mockReset();
    lookupAirportDetailsMock.mockReset();
    getWorldMapPayloadMock.mockReset();
    isChantalV2TestModeMock.mockReset();
    getTestLatestSnapshotMock.mockReset();
    getTestSnapshotTimestampsMock.mockReset();

    lookupAirportDetailsMock.mockResolvedValue(null);
    getWorldMapPayloadMock.mockResolvedValue({ countries: [], viewBox: { width: 1000, height: 560 } });
    isChantalV2TestModeMock.mockReturnValue(false);
    getLatestPositionSnapshotMock.mockResolvedValue(null);
    listPositionSnapshotTimestampsMock.mockResolvedValue([]);
    getTestLatestSnapshotMock.mockReturnValue({
      id: 'demo-snapshot-1',
      capturedAt: 1775586300000,
      tripId: 'demo-v2-global-meetup',
      tripName: 'Global Meetup – Tokyo',
      positions: [],
    });
    getTestSnapshotTimestampsMock.mockReturnValue([1775586300000, 1775586000000]);
  });

  it('keeps live mode for a non-demo selected trip even when no V2 snapshots exist yet', async () => {
    readFriendsTrackerConfigMock.mockResolvedValue({
      updatedAt: null,
      updatedBy: null,
      currentTripId: 'trip-live',
      trips: [
        {
          id: 'trip-live',
          name: 'Singapore 2026',
          isDemo: false,
          destinationAirport: 'SIN',
          friends: [
            {
              id: 'friend-1',
              name: 'Alex',
              flights: [
                {
                  id: 'leg-1',
                  flightNumber: 'SQ321',
                  departureTime: '2026-04-08T10:00:00.000Z',
                  from: 'LHR',
                  to: 'SIN',
                },
              ],
            },
          ],
        },
      ],
      friends: [],
    });

    const { default: ChantalV2Page } = await loadPageModule();
    render(await ChantalV2Page({ params: Promise.resolve({ locale: 'en' }) }));

    const props = JSON.parse(screen.getByTestId('chantal-v2-client-props').textContent ?? '{}');
    expect(props).toMatchObject({
      currentTripId: 'trip-live',
      initialSnapshotTripId: null,
      useDemoSnapshots: false,
    });
  });

  it('switches to demo mode when the selected trip is a demo/test trip', async () => {
    readFriendsTrackerConfigMock.mockResolvedValue({
      updatedAt: null,
      updatedBy: null,
      currentTripId: 'demo-test-trip',
      trips: [
        {
          id: 'demo-test-trip',
          name: 'Demo / Test Trip',
          isDemo: true,
          destinationAirport: 'SIN',
          friends: [],
        },
      ],
      friends: [],
    });

    const { default: ChantalV2Page } = await loadPageModule();
    render(await ChantalV2Page({ params: Promise.resolve({ locale: 'en' }) }));

    const props = JSON.parse(screen.getByTestId('chantal-v2-client-props').textContent ?? '{}');
    expect(props).toMatchObject({
      currentTripId: 'demo-v2-global-meetup',
      initialSnapshotTripId: 'demo-v2-global-meetup',
      useDemoSnapshots: true,
    });
  });
});
