import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDrawerShell } from '~/components/tracker/friends/ConfigDrawerShell';

const backMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('~/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    className,
    ...props
  }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({
    back: backMock,
    replace: replaceMock,
  }),
}));

describe('ConfigDrawerShell', () => {
  beforeEach(() => {
    backMock.mockReset();
    replaceMock.mockReset();
  });

  it('closes the drawer when clicking the backdrop or Close button', async () => {
    const user = userEvent.setup();

    render(
      <ConfigDrawerShell
        badge="Chantal quick admin"
        title="Cron flight prefetch"
        description="Review and update the shared cron dashboard."
        fullPageHref="/tracker/cron"
      >
        <div>Drawer content</div>
      </ConfigDrawerShell>,
    );

    await user.click(screen.getByRole('button', { name: /close admin drawer/i }));
    await user.click(screen.getByRole('button', { name: /^close$/i }));

    expect(backMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: /open standalone page/i })).toHaveAttribute('href', '/tracker/cron');
  });
});
