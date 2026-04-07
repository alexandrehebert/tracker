import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getLatestPositionSnapshotMock = vi.fn();
const getPositionSnapshotAtMock = vi.fn();
const listPositionSnapshotTimestampsMock = vi.fn();

vi.mock('~/lib/server/chantalV2Snapshots', () => ({
  getLatestPositionSnapshot: getLatestPositionSnapshotMock,
  getPositionSnapshotAt: getPositionSnapshotAtMock,
  listPositionSnapshotTimestamps: listPositionSnapshotTimestampsMock,
}));

async function loadSnapshotsRouteModule() {
  vi.resetModules();
  return await import('~/app/api/chantal/v2/snapshots/route');
}

describe('Chantal V2 snapshots route', () => {
  beforeEach(() => {
    delete process.env.CHANTAL_V2_TEST_MODE;
    getLatestPositionSnapshotMock.mockReset();
    getPositionSnapshotAtMock.mockReset();
    listPositionSnapshotTimestampsMock.mockReset();

    getLatestPositionSnapshotMock.mockResolvedValue(null);
    getPositionSnapshotAtMock.mockResolvedValue(null);
    listPositionSnapshotTimestampsMock.mockResolvedValue([]);
  });

  it('returns demo snapshot history when demo mode is explicitly requested', async () => {
    const { GET } = await loadSnapshotsRouteModule();

    const response = await GET(new NextRequest('http://localhost/api/chantal/v2/snapshots?demo=1'));
    expect(response.status).toBe(200);

    const body = await response.json() as {
      latest: { tripId: string; positions: Array<unknown> } | null;
      snapshotTimestamps: number[];
    };

    expect(body.latest).toMatchObject({
      tripId: 'demo-v2-global-meetup',
      positions: expect.any(Array),
    });
    expect(body.snapshotTimestamps.length).toBeGreaterThan(100);
    expect(getLatestPositionSnapshotMock).not.toHaveBeenCalled();
    expect(listPositionSnapshotTimestampsMock).not.toHaveBeenCalled();
  });

  it('returns a demo historical snapshot for wayback requests in demo mode', async () => {
    const { GET } = await loadSnapshotsRouteModule();
    const targetMs = Date.now() - (2 * 60 * 60 * 1000);

    const response = await GET(
      new NextRequest(`http://localhost/api/chantal/v2/snapshots?demo=1&at=${targetMs}`),
    );
    expect(response.status).toBe(200);

    const body = await response.json() as {
      snapshot: { tripId: string; capturedAt: number; positions: Array<unknown> } | null;
    };

    expect(body.snapshot).toMatchObject({
      tripId: 'demo-v2-global-meetup',
      positions: expect.any(Array),
    });
    expect(body.snapshot?.capturedAt).toBeLessThanOrEqual(targetMs);
    expect(getPositionSnapshotAtMock).not.toHaveBeenCalled();
  });

  it('scopes live snapshot history to the requested trip id', async () => {
    getLatestPositionSnapshotMock.mockResolvedValue({
      id: 'live-snapshot-1',
      capturedAt: 1775586300000,
      tripId: 'trip-live',
      tripName: 'Live Trip',
      positions: [],
    });
    listPositionSnapshotTimestampsMock.mockResolvedValue([1775586300000, 1775586000000]);

    const { GET } = await loadSnapshotsRouteModule();
    const response = await GET(new NextRequest('http://localhost/api/chantal/v2/snapshots?tripId=trip-live'));
    expect(response.status).toBe(200);

    const body = await response.json() as {
      latest: { tripId: string; positions: Array<unknown> } | null;
      snapshotTimestamps: number[];
    };

    expect(body.latest).toMatchObject({
      tripId: 'trip-live',
      positions: [],
    });
    expect(body.snapshotTimestamps).toEqual([1775586300000, 1775586000000]);
    expect(getLatestPositionSnapshotMock).toHaveBeenCalledWith('trip-live');
    expect(listPositionSnapshotTimestampsMock).toHaveBeenCalledWith(undefined, 'trip-live');
  });
});
