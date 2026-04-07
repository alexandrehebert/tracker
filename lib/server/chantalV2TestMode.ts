import 'server-only';

import type { ChantalPositionSnapshot } from '~/lib/chantalV2';
import {
  generateDemoV2Snapshot,
  getDemoV2SnapshotAt,
  getDemoV2SnapshotTimestamps,
} from '~/lib/chantalV2TestData';

/** Returns true when the CHANTAL_V2_TEST_MODE env var is set to "1" or "true". */
export function isChantalV2TestMode(): boolean {
  const value = process.env.CHANTAL_V2_TEST_MODE?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * Returns the most-recent demo snapshot (as of `now`).
 */
export function getTestLatestSnapshot(now = Date.now()): ChantalPositionSnapshot {
  const stepMs = 5 * 60_000;
  const latestBucket = Math.floor(now / stepMs) * stepMs;
  return generateDemoV2Snapshot(now, latestBucket);
}

/**
 * Returns all demo snapshot timestamps (newest first, covering 48 h).
 */
export function getTestSnapshotTimestamps(now = Date.now()): number[] {
  return getDemoV2SnapshotTimestamps(now, 576, 5 * 60_000);
}

/**
 * Returns the demo snapshot closest to `targetMs` (not after it).
 */
export function getTestSnapshotAt(targetMs: number, now = Date.now()): ChantalPositionSnapshot {
  return getDemoV2SnapshotAt(now, targetMs, 5 * 60_000);
}
