import { describe, expect, it } from 'vitest';
import {
  getProviderRequestContext,
  summarizeProviderRequestLogs,
  withProviderRequestContext,
  type ProviderRequestLogEntry,
} from '~/lib/server/providers/observability';

describe('provider observability', () => {
  it('aggregates request totals by provider and caller', () => {
    const logs: ProviderRequestLogEntry[] = [
      {
        id: '1',
        provider: 'opensky',
        caller: 'cron',
        operation: 'api:/states/all',
        status: 'success',
        durationMs: 420,
        createdAt: '2026-04-07T12:00:00.000Z',
        request: { method: 'GET' },
        response: { status: 200 },
      },
      {
        id: '2',
        provider: 'opensky',
        caller: 'on-demand',
        operation: 'api:/tracks/all',
        status: 'error',
        durationMs: 910,
        createdAt: '2026-04-07T12:05:00.000Z',
        request: { method: 'GET' },
        response: { status: 504 },
        error: { message: 'Gateway timeout' },
      },
      {
        id: '3',
        provider: 'flightaware',
        caller: 'config',
        operation: 'lookup-flight',
        status: 'cached',
        durationMs: 25,
        createdAt: '2026-04-07T12:07:00.000Z',
        request: { method: 'GET' },
        response: { status: 200 },
      },
      {
        id: '4',
        provider: 'aviationstack',
        caller: 'config',
        operation: 'lookup-flight',
        status: 'success',
        durationMs: 180,
        createdAt: '2026-04-07T12:10:00.000Z',
        request: { method: 'GET' },
        response: { status: 200 },
      },
    ];

    const dashboard = summarizeProviderRequestLogs(logs);

    expect(dashboard.overview.totalRequests).toBe(4);
    expect(dashboard.overview.errorCount).toBe(1);
    expect(dashboard.overview.cachedCount).toBe(1);
    expect(dashboard.overview.callers).toEqual([
      { caller: 'config', count: 2 },
      { caller: 'cron', count: 1 },
      { caller: 'on-demand', count: 1 },
    ]);

    expect(dashboard.providers.find((provider) => provider.name === 'opensky')).toMatchObject({
      totalRequests: 2,
      successCount: 1,
      errorCount: 1,
      callers: [
        { caller: 'cron', count: 1 },
        { caller: 'on-demand', count: 1 },
      ],
    });
  });

  it('propagates the current caller context across async work', async () => {
    const context = await withProviderRequestContext(
      {
        caller: 'config',
        source: 'chantal-validate-flight',
        metadata: { identifier: 'AF123' },
      },
      async () => {
        await Promise.resolve();
        return getProviderRequestContext();
      },
    );

    expect(context).toMatchObject({
      caller: 'config',
      source: 'chantal-validate-flight',
      metadata: { identifier: 'AF123' },
    });
  });
});
