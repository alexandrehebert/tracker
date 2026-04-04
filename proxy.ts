import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all pathnames except for:
    // - API routes
    // - _next internals
    // - Files with extensions (static assets)
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
