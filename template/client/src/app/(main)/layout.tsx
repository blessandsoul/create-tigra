import type React from 'react';

import { MainLayout } from '@/components/layout/MainLayout';

export default function MainRouteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return <MainLayout>{children}</MainLayout>;
}
