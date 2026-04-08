import { afterEach, describe, expect, it } from 'vitest';
import { isFlightAwareConfigured, hasFlightAwareCredentials } from '~/lib/server/providers/flightaware';

const originalFlightAwareApiKey = process.env.FLIGHT_AWARE_API_KEY;
const originalFlightAwareDisabled = process.env.FLIGHTAWARE_DISABLED;

afterEach(() => {
  if (originalFlightAwareApiKey === undefined) {
    delete process.env.FLIGHT_AWARE_API_KEY;
  } else {
    process.env.FLIGHT_AWARE_API_KEY = originalFlightAwareApiKey;
  }

  if (originalFlightAwareDisabled === undefined) {
    delete process.env.FLIGHTAWARE_DISABLED;
  } else {
    process.env.FLIGHTAWARE_DISABLED = originalFlightAwareDisabled;
  }
});

describe('provider configuration helpers', () => {
  it('keeps credential detection separate from runtime disable flags for FlightAware', () => {
    process.env.FLIGHT_AWARE_API_KEY = 'test-flightaware-key';
    process.env.FLIGHTAWARE_DISABLED = 'true';

    expect(hasFlightAwareCredentials()).toBe(true);
    expect(isFlightAwareConfigured()).toBe(false);
  });
});
