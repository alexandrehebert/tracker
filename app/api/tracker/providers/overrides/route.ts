import { NextRequest, NextResponse } from 'next/server';
import { ALL_PROVIDERS, type ProviderName } from '~/lib/server/providers';
import {
  isProviderOverridesStorageConfigured,
  readProviderOverrides,
  writeProviderOverride,
  type ProviderOverrideState,
} from '~/lib/server/providers/overrides';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';
export const maxDuration = 30;

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function GET() {
  try {
    const overrides = await readProviderOverrides();
    return buildJsonResponse({
      overrides,
      storageConfigured: isProviderOverridesStorageConfigured(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load provider overrides.';
    return buildJsonResponse({ error: message }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      provider?: string;
      state?: string;
    } | null;

    if (!body?.provider || !(ALL_PROVIDERS as readonly string[]).includes(body.provider)) {
      return buildJsonResponse({ error: `Invalid provider. Must be one of: ${ALL_PROVIDERS.join(', ')}.` }, 400);
    }

    const validStates: (ProviderOverrideState | string)[] = ['enabled', 'disabled', null, 'null', 'reset'];
    if (!validStates.includes(body.state ?? null)) {
      return buildJsonResponse({ error: 'Invalid state. Must be "enabled", "disabled", or null (to reset).' }, 400);
    }

    const state: ProviderOverrideState = (body.state === 'null' || body.state === 'reset' || body.state == null)
      ? null
      : (body.state as 'enabled' | 'disabled');

    await writeProviderOverride(body.provider as ProviderName, state, 'providers admin page');

    const overrides = await readProviderOverrides();
    return buildJsonResponse({
      overrides,
      storageConfigured: isProviderOverridesStorageConfigured(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update provider override.';
    return buildJsonResponse({ error: message }, 500);
  }
}
