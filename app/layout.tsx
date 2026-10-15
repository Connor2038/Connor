import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Vivix Studio',
  description: 'A live avatar, ready to make your own.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Ignore root-only attributes injected by browser extensions; keep child checks enabled.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
