'use client';

import dynamic from 'next/dynamic';

// The editor and presenter use the URL hash, window messaging and browser storage.
export const Studio = dynamic(() => import('../src/studio-client'), { ssr: false });
