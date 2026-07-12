import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'SwingCare Coach',
  description: 'SwingCare 코치 대시보드',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
