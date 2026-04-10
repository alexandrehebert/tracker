import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRouteLoadingProvider, useGlobalRouteLoading } from '~/components/GlobalRouteLoadingProvider';

let mockPathname = '/en';
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

function LoadingControls() {
  const { startRouteLoading, stopRouteLoading } = useGlobalRouteLoading();

  return (
    <>
      <button type="button" onClick={startRouteLoading}>Start loading</button>
      <button type="button" onClick={stopRouteLoading}>Stop loading</button>
    </>
  );
}

describe('GlobalRouteLoadingProvider', () => {
  beforeEach(() => {
    mockPathname = '/en';
    mockSearchParams = new URLSearchParams();
  });

  it('shows a loading indicator immediately for same-origin route links', () => {
    render(
      <GlobalRouteLoadingProvider>
        <a href="/en/chantal" onClick={(event) => event.preventDefault()}>
          Crew tracker
        </a>
      </GlobalRouteLoadingProvider>,
    );

    fireEvent.click(screen.getByRole('link', { name: /crew tracker/i }));

    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
  });

  it('can be started and stopped for in-place refreshes', () => {
    render(
      <GlobalRouteLoadingProvider>
        <LoadingControls />
      </GlobalRouteLoadingProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /start loading/i }));
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /stop loading/i }));
    expect(screen.queryByRole('status', { name: /loading page/i })).not.toBeInTheDocument();
  });
});
