'use client';

import type { MouseEvent } from 'react';
import { Link } from '~/i18n/navigation';
import { useGlobalRouteLoading } from '~/components/GlobalRouteLoadingProvider';

type RouteLoadingLinkProps = React.ComponentProps<typeof Link>;

function isClientSideNavigationClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0
    && !event.metaKey
    && !event.altKey
    && !event.ctrlKey
    && !event.shiftKey;
}

export function RouteLoadingLink({ children, onClick, ...linkProps }: RouteLoadingLinkProps) {
  const { startRouteLoading } = useGlobalRouteLoading();

  return (
    <Link
      {...linkProps}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isClientSideNavigationClick(event)) {
          return;
        }
        startRouteLoading();
      }}
    >
      {children}
    </Link>
  );
}