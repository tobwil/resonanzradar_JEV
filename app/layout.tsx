import type { Metadata } from 'next';
import { Geist, Geist_Mono, Manrope } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ResonanzRadar — JEV-Nachrichtenanalyse',
  description: 'Nachrichtenfeeds vergleichen: sprachliche Zuspitzung, dargestellte Bedrohung und politische Problemrahmung mit überprüfbaren Textstellen.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable}`}>{children}</body>
    </html>
  );
}
