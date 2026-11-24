'use client';

import { Suspense } from 'react';
import { DatasetStudio } from '@/app/components/studio/dataset-studio';

export function DatasetWorkbench() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center bg-[var(--ss-canvas)] font-mono text-xs text-[var(--ss-muted)]" role="status">
          Loading data workbench…
        </main>
      }
    >
      <DatasetStudio />
    </Suspense>
  );
}
