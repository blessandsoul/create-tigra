import type React from 'react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function DashboardPage(): React.ReactElement {
  return (
    <div className="container mx-auto px-4 py-12 md:px-6 lg:px-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-muted-foreground">
            Welcome to your dashboard. This is where you&apos;ll manage everything.
          </p>
        </div>
      </div>
    </div>
  );
}
