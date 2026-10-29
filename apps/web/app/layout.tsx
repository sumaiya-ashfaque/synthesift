import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SyntheSift | AI-Powered Data Quality Analysis & Remediation',
  description: 'Data-quality intelligence platform — foundation and service diagnostics',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
