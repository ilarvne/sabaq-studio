import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter/wght.css';
import '@sabaq/slide-renderer/fonts.css';
import '../src/styles.css';
import '../src/motion.css';
import { restoreAppearanceScript, studioColors } from '../src/appearance';

export const metadata: Metadata = {
  title: 'Sabaq Studio',
  icons: { icon: '/sabaq-mark.svg' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="kk" data-appearance="dark" suppressHydrationWarning>
    <head>
      <meta name="theme-color" content={studioColors.dark} suppressHydrationWarning/>
      <script dangerouslySetInnerHTML={{ __html: restoreAppearanceScript }}/>
    </head>
    <body><div id="root">{children}</div></body>
  </html>;
}
