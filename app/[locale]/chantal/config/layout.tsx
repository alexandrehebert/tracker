import type { ReactNode } from 'react';

interface ChantalConfigLayoutProps {
  children: ReactNode;
  drawer: ReactNode;
}

export default function ChantalConfigLayout({ children, drawer }: ChantalConfigLayoutProps) {
  return (
    <>
      {children}
      {drawer}
    </>
  );
}
