import type React from 'react';

export default function AuthRouteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return <main className="flex min-h-dvh items-center justify-center p-4">{children}</main>;
}
